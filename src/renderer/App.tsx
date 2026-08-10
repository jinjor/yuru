import {
  Activity,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import "@xterm/xterm/css/xterm.css";
import { AlertTriangle } from "lucide-react";
import type { AppError, AppErrorNotice } from "../shared/ipc";
import type { RepoListItem } from "../shared/metadata";
import type { ProviderPlanUsage } from "../shared/session";
import { AppErrorToast } from "./components/AppErrorToast";
import { BranchNameInput, type CreateWorktreeMode } from "./components/BranchNameInput";
import { ErrorLogModal } from "./components/ErrorLogModal";
import { ProviderPlanUsageRows } from "./components/ProviderPlanUsageRows";
import { RepoList } from "./components/RepoList";
import { SessionView } from "./components/SessionView";
import { WorktreeRemovalDialog } from "./components/WorktreeRemovalDialog";
import { clamp, runPointerDrag } from "./utils/layout";
import {
  applyPullRequestUpdates,
  applySessionUpdate,
  collectKeepAliveWorktrees,
  findWorktree,
} from "./utils/repoList";

export function App() {
  const appRef = useRef<HTMLDivElement>(null);
  const repoRefreshRequestRef = useRef(0);
  const worktreeCreateRequestRef = useRef(0);
  const [repos, setRepos] = useState<RepoListItem[]>([]);
  // main のポーリングが決めるプラン利用状況。ここに居る provider が
  // インストール済みの provider でもあるので、新規セッションの選択肢もこれで決まる。
  const [planUsages, setPlanUsages] = useState<ProviderPlanUsage[]>([]);
  const [selectedWorktreeId, setSelectedWorktreeId] = useState<string | null>(null);
  // 一度選択した worktree の id。keep-alive の対象 (main ∪ 訪問済み ∪ 選択中) を決める。
  // 選択解除 (削除・作成中断など) では触らない — 一度訪れた worktree はそのまま残す。
  const [visitedWorktreeIds, setVisitedWorktreeIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [worktreeTarget, setWorktreeTarget] = useState<string | null>(null);
  const [worktreeError, setWorktreeError] = useState<string | null>(null);
  const [removalTargetId, setRemovalTargetId] = useState<string | null>(null);
  const [removingWorktreeIds, setRemovingWorktreeIds] = useState<Set<string>>(() => new Set());
  const [sidebarWidth, setSidebarWidth] = useState(390);
  const [errorNotices, setErrorNotices] = useState<AppErrorNotice[]>([]);
  const [isErrorLogOpen, setIsErrorLogOpen] = useState(false);
  const [toastError, setToastError] = useState<AppError | null>(null);
  const removalTarget = findWorktree(repos, removalTargetId);
  // インストールされている provider だけが利用状況に現れる。
  const availableProviders = useMemo(() => planUsages.map((usage) => usage.provider), [planUsages]);
  const keepAliveWorktrees = collectKeepAliveWorktrees(
    repos,
    selectedWorktreeId,
    visitedWorktreeIds,
  );

  const selectWorktree = useCallback((worktreeId: string): void => {
    setSelectedWorktreeId(worktreeId);
    setVisitedWorktreeIds((prev) => (prev.has(worktreeId) ? prev : new Set(prev).add(worktreeId)));
  }, []);

  const dismissToast = useCallback((): void => {
    setToastError(null);
  }, []);

  const refreshRepos = useCallback(async (): Promise<RepoListItem[] | null> => {
    const requestId = ++repoRefreshRequestRef.current;
    try {
      const nextRepos = await window.electronAPI.getRepos();
      if (repoRefreshRequestRef.current !== requestId) {
        return null;
      }
      setRepos(nextRepos);
      // requestId ガードの内側で行うことで、古い一覧が遅れて届いた時に
      // 作成直後の worktree の選択を誤って解除しない。
      setSelectedWorktreeId((prev) => (prev && !findWorktree(nextRepos, prev) ? null : prev));
      return nextRepos;
    } catch (error) {
      if (repoRefreshRequestRef.current !== requestId) {
        return null;
      }
      console.error("Failed to load repos.", error);
      return null;
    }
  }, []);

  const openExternal = useCallback((url: string): void => {
    void window.electronAPI.openExternal(url).catch((error) => {
      console.error("Failed to open external URL.", error);
    });
  }, []);

  useEffect(() => {
    void refreshRepos();
    const disposeRepoListChanged = window.electronAPI.onRepoListChanged(() => {
      void refreshRepos();
    });
    // 表示中 runtime の切り替えは SessionView が自分の購読で行う。ここでは左ペインの
    // dot / preview を更新するために一覧を取り直すだけ。
    const disposeTerminalRuntimeExited = window.electronAPI.onTerminalRuntimeExited(() => {
      void refreshRepos();
    });
    const disposeSessionChanged = window.electronAPI.onSessionChanged(
      (terminalRuntimeId, update) => {
        setRepos((prev) => applySessionUpdate(prev, terminalRuntimeId, update));
      },
    );
    const disposePullRequestsChanged = window.electronAPI.onPullRequestsChanged((updates) => {
      setRepos((prev) => applyPullRequestUpdates(prev, updates));
    });
    // push を購読する前に最初の tick が終わっている場合があるので、最新値も取りに行く。
    window.electronAPI
      .getProviderPlanUsage()
      .then(setPlanUsages)
      .catch((error) => {
        console.error("Failed to load provider plan usage.", error);
      });
    const disposePlanUsageChanged = window.electronAPI.onProviderPlanUsageChanged(setPlanUsages);
    return () => {
      disposeRepoListChanged();
      disposeTerminalRuntimeExited();
      disposeSessionChanged();
      disposePullRequestsChanged();
      disposePlanUsageChanged();
    };
  }, [refreshRepos]);

  // error center (main 側) の一覧をミラーする。初期表示は取得、以降は変更の push で置き換える。
  useEffect(() => {
    window.electronAPI
      .getErrors()
      .then(setErrorNotices)
      .catch((error) => {
        console.error("Failed to load error notices.", error);
      });
    return window.electronAPI.onErrorNoticesChanged(setErrorNotices);
  }, []);

  const handleSidebarResizeStart = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>): void => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = sidebarWidth;
      const appWidth = appRef.current?.clientWidth ?? 0;
      if (appWidth === 0) {
        return;
      }

      runPointerDrag("col-resize", (moveEvent) => {
        const reservedSessionViewWidth = selectedWorktreeId ? 520 : 640;
        const maxWidth = Math.max(220, appWidth - reservedSessionViewWidth);
        setSidebarWidth(clamp(startWidth + moveEvent.clientX - startX, 220, maxWidth));
      });
    },
    [selectedWorktreeId, sidebarWidth],
  );

  const handleWorktreeRemovalReady = useCallback(
    (worktreeId: string, force: boolean): void => {
      setRemovalTargetId((prev) => (prev === worktreeId ? null : prev));
      setRemovingWorktreeIds((prev) => new Set(prev).add(worktreeId));

      void window.electronAPI
        .executeWorktreeRemoval(worktreeId, force)
        .then((result) => {
          if (result.ok) {
            setRepos((prev) =>
              prev.map((repo) => ({
                ...repo,
                taskWorktrees: repo.taskWorktrees.filter(
                  (worktree) => worktree.worktreeId !== worktreeId,
                ),
              })),
            );
            setSelectedWorktreeId((prev) => (prev === worktreeId ? null : prev));
          }
          void refreshRepos();
        })
        .catch((error) => {
          console.error("Failed to remove worktree.", error);
          void refreshRepos();
        })
        .finally(() => {
          setRemovingWorktreeIds((prev) => {
            const next = new Set(prev);
            next.delete(worktreeId);
            return next;
          });
        });
    },
    [refreshRepos],
  );

  const handleCreateWorktree = useCallback(
    async (mode: CreateWorktreeMode, branchName: string): Promise<void> => {
      if (!worktreeTarget) {
        return;
      }

      const repoPath = worktreeTarget;
      const requestId = ++worktreeCreateRequestRef.current;
      setWorktreeError(null);
      const result =
        mode === "from-origin"
          ? await window.electronAPI.createTaskWorktreeFromRemoteBranch(repoPath, branchName)
          : await window.electronAPI.createTaskWorktree(repoPath, branchName);
      // fetch 中にモーダルを閉じて開き直せるため、その後に届いた古い結果は反映しない。
      // 作成が成功していれば worktree watcher の push で一覧に現れ、失敗は error center に残る。
      if (worktreeCreateRequestRef.current !== requestId) {
        return;
      }
      if (!result.ok) {
        setWorktreeError(result.error.detail ?? result.error.message);
        return;
      }

      selectWorktree(result.data.worktreeId);
      setWorktreeTarget(null);
      void refreshRepos();
    },
    [refreshRepos, selectWorktree, worktreeTarget],
  );

  const errorCount = errorNotices.filter((notice) => notice.severity === "error").length;
  const warningCount = errorNotices.length - errorCount;

  return (
    <div className="app" ref={appRef}>
      <aside className="sidebar" style={{ width: sidebarWidth, minWidth: sidebarWidth }}>
        <div className="sidebar-section">
          <div className="sidebar-header">
            <h2>Repos</h2>
          </div>
          <RepoList
            repos={repos}
            selectedWorktreeId={selectedWorktreeId}
            removingWorktreeIds={removingWorktreeIds}
            onCreateWorktree={(repoPath) => {
              setWorktreeError(null);
              setWorktreeTarget(repoPath);
            }}
            onSelectWorktree={(worktree) => selectWorktree(worktree.worktreeId)}
            onRequestRemoveWorktree={setRemovalTargetId}
          />
        </div>
        <ProviderPlanUsageRows usages={planUsages} />
        <button
          type="button"
          className={`sidebar-errors-row${errorCount > 0 ? " has-errors" : ""}`}
          onClick={() => setIsErrorLogOpen(true)}
        >
          <AlertTriangle size={12} strokeWidth={2} aria-hidden="true" />
          <span>Errors</span>
          <span className="sidebar-errors-badges">
            {errorCount > 0 && <span className="error-count-badge">{errorCount}</span>}
            {warningCount > 0 && <span className="error-count-badge warning">{warningCount}</span>}
          </span>
        </button>
      </aside>
      <div
        className="pane-resize-handle vertical"
        onMouseDown={handleSidebarResizeStart}
        aria-hidden="true"
      />
      {keepAliveWorktrees.map((worktree) => (
        <Activity
          key={worktree.worktreeId}
          mode={worktree.worktreeId === selectedWorktreeId ? "visible" : "hidden"}
        >
          <SessionView
            appRef={appRef}
            onOpenExternal={openExternal}
            providers={availableProviders}
            sidebarWidth={sidebarWidth}
            worktree={worktree}
            worktreeId={worktree.worktreeId}
            onError={setToastError}
            onSessionsChanged={refreshRepos}
          />
        </Activity>
      ))}
      {!selectedWorktreeId && <SessionPlaceholder />}
      {worktreeTarget && (
        <BranchNameInput
          onSubmit={handleCreateWorktree}
          onChange={() => setWorktreeError(null)}
          onCancel={() => {
            worktreeCreateRequestRef.current++;
            setWorktreeError(null);
            setWorktreeTarget(null);
          }}
          error={worktreeError}
        />
      )}
      {removalTarget && (
        <WorktreeRemovalDialog
          worktree={removalTarget}
          topOffset={120}
          onClose={() => setRemovalTargetId(null)}
          onReady={handleWorktreeRemovalReady}
        />
      )}
      {isErrorLogOpen && (
        <ErrorLogModal notices={errorNotices} onClose={() => setIsErrorLogOpen(false)} />
      )}
      {toastError && <AppErrorToast error={toastError} onDismiss={dismissToast} />}
    </div>
  );
}

function SessionPlaceholder() {
  return (
    <main className="terminal-container">
      <div className="empty-state terminal-empty-state">
        <p>Select a worktree</p>
      </div>
    </main>
  );
}
