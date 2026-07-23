import {
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import "@xterm/xterm/css/xterm.css";
import { AlertTriangle } from "lucide-react";
import type { AgentDefinition } from "../shared/agent";
import type { AppErrorNotice, PullRequestUpdate, SessionUpdate } from "../shared/ipc";
import type { RepoListItem, WorktreeListItem } from "../shared/metadata";
import { type GitHubPullRequest, type TerminalRuntimeId } from "../shared/session";
import { BranchNameInput, type CreateWorktreeMode } from "./components/BranchNameInput";
import { ErrorLogModal } from "./components/ErrorLogModal";
import { RepoList } from "./components/RepoList";
import { SessionView } from "./components/SessionView";
import { WorktreeRemovalDialog } from "./components/WorktreeRemovalDialog";
import { clamp } from "./utils/layout";

export function App() {
  const appRef = useRef<HTMLDivElement>(null);
  const repoRefreshRequestRef = useRef(0);
  const worktreeCreateRequestRef = useRef(0);
  const [repos, setRepos] = useState<RepoListItem[]>([]);
  const [availableProviders, setAvailableProviders] = useState<AgentDefinition[]>([]);
  const [selectedWorktreeId, setSelectedWorktreeId] = useState<string | null>(null);
  const [worktreeTarget, setWorktreeTarget] = useState<string | null>(null);
  const [worktreeError, setWorktreeError] = useState<string | null>(null);
  const [removalTargetId, setRemovalTargetId] = useState<string | null>(null);
  const [removingWorktreeIds, setRemovingWorktreeIds] = useState<Set<string>>(() => new Set());
  const [sidebarWidth, setSidebarWidth] = useState(390);
  const [errorNotices, setErrorNotices] = useState<AppErrorNotice[]>([]);
  const [isErrorLogOpen, setIsErrorLogOpen] = useState(false);
  const selectedWorktree = findWorktree(repos, selectedWorktreeId);
  const removalTarget = findWorktree(repos, removalTargetId);

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
    window.electronAPI
      .getSessionProviders()
      .then((providers) => {
        setAvailableProviders(providers);
      })
      .catch((error) => {
        console.error("Failed to load session providers.", error);
      });

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
    return () => {
      disposeRepoListChanged();
      disposeTerminalRuntimeExited();
      disposeSessionChanged();
      disposePullRequestsChanged();
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

      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const handleMouseMove = (moveEvent: globalThis.MouseEvent): void => {
        const reservedSessionViewWidth = selectedWorktreeId ? 520 : 640;
        const maxWidth = Math.max(220, appWidth - reservedSessionViewWidth);
        setSidebarWidth(clamp(startWidth + moveEvent.clientX - startX, 220, maxWidth));
      };

      const stopDragging = (): void => {
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", stopDragging);
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", stopDragging);
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

      setSelectedWorktreeId(result.data.worktreeId);
      setWorktreeTarget(null);
      void refreshRepos();
    },
    [refreshRepos, worktreeTarget],
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
            onSelectWorktree={(worktree) => setSelectedWorktreeId(worktree.worktreeId)}
            onRequestRemoveWorktree={setRemovalTargetId}
          />
        </div>
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
      {selectedWorktreeId ? (
        <SessionView
          key={selectedWorktreeId}
          appRef={appRef}
          onOpenExternal={openExternal}
          providers={availableProviders}
          sidebarWidth={sidebarWidth}
          worktree={selectedWorktree}
          worktreeId={selectedWorktreeId}
          onSessionsChanged={refreshRepos}
        />
      ) : (
        <SessionPlaceholder />
      )}
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
    </div>
  );
}

function findWorktree(repos: RepoListItem[], worktreeId: string | null): WorktreeListItem | null {
  if (!worktreeId) {
    return null;
  }
  for (const repo of repos) {
    if (repo.mainWorktree.worktreeId === worktreeId) {
      return repo.mainWorktree;
    }
    const taskWorktree = repo.taskWorktrees.find((entry) => entry.worktreeId === worktreeId);
    if (taskWorktree) {
      return taskWorktree;
    }
  }
  return null;
}

// メインプロセスから push されたセッション更新を、該当セッションを表示している項目に merge する。
function applySessionUpdate(
  repos: RepoListItem[],
  terminalRuntimeId: TerminalRuntimeId,
  update: SessionUpdate,
): RepoListItem[] {
  return repos.map((repo) => ({
    ...repo,
    taskWorktrees: repo.taskWorktrees.map((worktree) => ({
      ...worktree,
      primarySession:
        worktree.primarySession?.activeTerminalRuntimeId === terminalRuntimeId
          ? { ...worktree.primarySession, ...update }
          : worktree.primarySession,
      suggestedSessions: worktree.suggestedSessions.map((session) =>
        session.activeTerminalRuntimeId === terminalRuntimeId ? { ...session, ...update } : session,
      ),
    })),
  }));
}

// メインプロセスの PR ポーリングから push された PR 情報を該当 worktree に merge する。
// フォーカス直後は変化のない全量 push が来るので、値が同じ項目はオブジェクトを
// 差し替えず、何も変わらなければ prev をそのまま返して再描画を避ける。
function applyPullRequestUpdates(
  repos: RepoListItem[],
  updates: PullRequestUpdate[],
): RepoListItem[] {
  const pullRequestsByWorktreeId = new Map(
    updates.map((update) => [update.worktreeId, update.pullRequest]),
  );
  let changed = false;
  const next = repos.map((repo) => {
    const taskWorktrees = repo.taskWorktrees.map((worktree) => {
      if (!pullRequestsByWorktreeId.has(worktree.worktreeId)) {
        return worktree;
      }
      const pullRequest = pullRequestsByWorktreeId.get(worktree.worktreeId) ?? null;
      if (samePullRequest(worktree.githubPullRequest ?? null, pullRequest)) {
        return worktree;
      }
      changed = true;
      return { ...worktree, githubPullRequest: pullRequest };
    });
    return taskWorktrees.some((worktree, i) => worktree !== repo.taskWorktrees[i])
      ? { ...repo, taskWorktrees }
      : repo;
  });
  return changed ? next : repos;
}

function samePullRequest(a: GitHubPullRequest | null, b: GitHubPullRequest | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  return a.prNumber === b.prNumber && a.state === b.state && a.url === b.url;
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
