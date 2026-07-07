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
import type { AppErrorNotice, SessionUpdate } from "../shared/ipc";
import type { RepoListItem, WorktreeListItem } from "../shared/metadata";
import { type TerminalRuntimeId, type SessionProvider } from "../shared/session";
import { BranchNameInput } from "./components/BranchNameInput";
import { ErrorLogModal } from "./components/ErrorLogModal";
import { RepoList } from "./components/RepoList";
import { SessionView } from "./components/SessionView";
import { WorktreeRemovalDialog } from "./components/WorktreeRemovalDialog";
import { clamp } from "./utils/layout";

export function App() {
  const appRef = useRef<HTMLDivElement>(null);
  const resumeRequestRef = useRef(0);
  const repoRefreshRequestRef = useRef(0);
  const [repos, setRepos] = useState<RepoListItem[]>([]);
  const [availableProviders, setAvailableProviders] = useState<AgentDefinition[]>([]);
  const [selection, setSelection] = useState<{
    worktreeId: string;
    terminalRuntimeId: TerminalRuntimeId;
  } | null>(null);
  const [worktreeTarget, setWorktreeTarget] = useState<string | null>(null);
  const [worktreeError, setWorktreeError] = useState<string | null>(null);
  const [removalTargetId, setRemovalTargetId] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [errorNotices, setErrorNotices] = useState<AppErrorNotice[]>([]);
  const [isErrorLogOpen, setIsErrorLogOpen] = useState(false);
  const selectedWorktreeId = selection?.worktreeId ?? null;
  const selectedTerminalRuntimeId = selection?.terminalRuntimeId ?? null;
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
    const disposeTerminalRuntimeExited = window.electronAPI.onTerminalRuntimeExited(
      (terminalRuntimeId) => {
        setSelection((prev) => (prev?.terminalRuntimeId === terminalRuntimeId ? null : prev));
        void refreshRepos();
      },
    );
    const disposeSessionChanged = window.electronAPI.onSessionChanged(
      (terminalRuntimeId, update) => {
        setRepos((prev) => applySessionUpdate(prev, terminalRuntimeId, update));
      },
    );
    return () => {
      disposeRepoListChanged();
      disposeTerminalRuntimeExited();
      disposeSessionChanged();
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
        const reservedSessionViewWidth = selectedTerminalRuntimeId ? 520 : 640;
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
    [selectedTerminalRuntimeId, sidebarWidth],
  );

  const handleResumePrimarySession = useCallback(
    async (worktreeId: string, providerSessionKey: string): Promise<void> => {
      const requestId = ++resumeRequestRef.current;
      const result = await window.electronAPI.resumePrimarySession(worktreeId, providerSessionKey);
      if (resumeRequestRef.current !== requestId) {
        return;
      }
      if (!result.ok) {
        return;
      }

      setSelection(result.data);
      void refreshRepos();
    },
    [refreshRepos],
  );

  const handleResumeSuggestedSession = useCallback(
    async (worktreeId: string, providerSessionKey: string): Promise<void> => {
      const requestId = ++resumeRequestRef.current;
      const result = await window.electronAPI.resumeSuggestedSession(
        worktreeId,
        providerSessionKey,
      );
      if (resumeRequestRef.current !== requestId) {
        return;
      }
      if (!result.ok) {
        return;
      }

      setSelection(result.data);
      void refreshRepos();
    },
    [refreshRepos],
  );

  const handleCreateSessionForWorktree = useCallback(
    async (worktreeId: string, provider: SessionProvider): Promise<void> => {
      const requestId = ++resumeRequestRef.current;
      const result = await window.electronAPI.createSessionForWorktree(worktreeId, provider);
      if (resumeRequestRef.current !== requestId) {
        return;
      }
      if (!result.ok) {
        return;
      }

      setSelection(result.data);
      void refreshRepos().then((nextRepos) => {
        if (!nextRepos) {
          return;
        }
        setSelection((prev) => {
          if (prev?.worktreeId !== result.data.worktreeId) {
            return prev;
          }
          const terminalRuntimeId = findActiveTerminalRuntimeId(nextRepos, prev.worktreeId);
          return terminalRuntimeId ? { worktreeId: prev.worktreeId, terminalRuntimeId } : prev;
        });
      });
    },
    [refreshRepos],
  );

  const handleOpenWorktreeTerminal = useCallback(
    async (worktreeId: string): Promise<void> => {
      const requestId = ++resumeRequestRef.current;
      const result = await window.electronAPI.openWorktreeTerminal(worktreeId);
      if (resumeRequestRef.current !== requestId) {
        return;
      }
      if (!result.ok) {
        return;
      }

      setSelection(result.data);
      void refreshRepos();
    },
    [refreshRepos],
  );

  const handleWorktreeRemoved = useCallback(
    (worktreeId: string): void => {
      setRemovalTargetId(null);
      setSelection((prev) => (prev?.worktreeId === worktreeId ? null : prev));
      void refreshRepos();
    },
    [refreshRepos],
  );

  const handleCreateWorktreeSession = useCallback(
    async (branchName: string, provider: SessionProvider): Promise<void> => {
      if (!worktreeTarget) {
        return;
      }

      const repoPath = worktreeTarget;
      setWorktreeError(null);
      const result = await window.electronAPI.createWorktreeSession(provider, repoPath, branchName);
      if (!result.ok) {
        setWorktreeError(result.error.detail ?? result.error.message);
        return;
      }

      setSelection(result.data);
      setWorktreeTarget(null);
      void refreshRepos().then((nextRepos) => {
        if (!nextRepos) {
          return;
        }
        setSelection((prev) => {
          if (prev?.worktreeId !== result.data.worktreeId) {
            return prev;
          }
          const terminalRuntimeId = findActiveTerminalRuntimeId(nextRepos, prev.worktreeId);
          return terminalRuntimeId ? { worktreeId: prev.worktreeId, terminalRuntimeId } : prev;
        });
      });
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
            providers={availableProviders}
            selectedWorktreeId={selectedWorktreeId}
            onCreateWorktreeSession={(repoPath) => {
              setWorktreeError(null);
              setWorktreeTarget(repoPath);
            }}
            onSelectActiveSession={(worktreeId, terminalRuntimeId) =>
              setSelection({ worktreeId, terminalRuntimeId })
            }
            onResumePrimarySession={handleResumePrimarySession}
            onResumeSuggestedSession={handleResumeSuggestedSession}
            onCreateSessionForWorktree={handleCreateSessionForWorktree}
            onOpenWorktreeTerminal={handleOpenWorktreeTerminal}
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
      {selectedWorktreeId && selectedTerminalRuntimeId ? (
        <SessionView
          key={`${selectedWorktreeId}:${selectedTerminalRuntimeId}`}
          appRef={appRef}
          currentBranch={selectedWorktree?.branch ?? null}
          currentGitHub={selectedWorktree?.githubPullRequest ?? null}
          onOpenExternal={openExternal}
          terminalRuntimeId={selectedTerminalRuntimeId}
          sidebarWidth={sidebarWidth}
          worktreeId={selectedWorktreeId}
        />
      ) : (
        <SessionPlaceholder />
      )}
      {worktreeTarget && (
        <BranchNameInput
          providers={availableProviders}
          onSubmit={handleCreateWorktreeSession}
          onChange={() => setWorktreeError(null)}
          onCancel={() => {
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
          onRemoved={handleWorktreeRemoved}
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

function findActiveTerminalRuntimeId(
  repos: RepoListItem[],
  worktreeId: string,
): TerminalRuntimeId | null {
  const taskWorktree = findWorktree(repos, worktreeId);
  return (
    taskWorktree?.primarySession?.activeTerminalRuntimeId ??
    taskWorktree?.suggestedSessions.find((session) => session.activeTerminalRuntimeId)
      ?.activeTerminalRuntimeId ??
    null
  );
}

function SessionPlaceholder() {
  return (
    <main className="terminal-container">
      <div className="empty-state terminal-empty-state">
        <p>Select a session to resume</p>
      </div>
    </main>
  );
}
