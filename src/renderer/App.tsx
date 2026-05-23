import {
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import "@xterm/xterm/css/xterm.css";
import type { AgentDefinition } from "../shared/agent";
import type { RepoListItem, TaskWorktreeListItem } from "../shared/metadata";
import { type RuntimeSessionId, type SessionProvider } from "../shared/session";
import { BranchNameInput } from "./components/BranchNameInput";
import { RepoList } from "./components/RepoList";
import { SessionView } from "./components/SessionView";
import { clamp } from "./utils/layout";

export function App() {
  const appRef = useRef<HTMLDivElement>(null);
  const resumeRequestRef = useRef(0);
  const [repos, setRepos] = useState<RepoListItem[]>([]);
  const [availableProviders, setAvailableProviders] = useState<AgentDefinition[]>([]);
  const [selection, setSelection] = useState<{
    worktreeId: string;
    runtimeSessionId: RuntimeSessionId;
  } | null>(null);
  const [worktreeTarget, setWorktreeTarget] = useState<string | null>(null);
  const [worktreeError, setWorktreeError] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const selectedWorktreeId = selection?.worktreeId ?? null;
  const selectedRuntimeSessionId = selection?.runtimeSessionId ?? null;

  const refreshRepos = useCallback(async (): Promise<RepoListItem[]> => {
    try {
      const nextRepos = await window.electronAPI.getRepos();
      setRepos(nextRepos);
      return nextRepos;
    } catch (error) {
      console.error("Failed to load repos.", error);
      return [];
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
    window.electronAPI.onSessionsStateChanged(() => {
      void refreshRepos().then((nextRepos) => {
        setSelection((prev) => {
          if (!prev) {
            return null;
          }
          const runtimeSessionId = findActiveRuntimeSessionId(nextRepos, prev.worktreeId);
          return runtimeSessionId ? { worktreeId: prev.worktreeId, runtimeSessionId } : null;
        });
      });
    });
  }, [refreshRepos]);

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
        const reservedSessionViewWidth = selectedRuntimeSessionId ? 520 : 640;
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
    [selectedRuntimeSessionId, sidebarWidth],
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
        setSelection((prev) => {
          if (prev?.worktreeId !== result.data.worktreeId) {
            return prev;
          }
          const runtimeSessionId = findActiveRuntimeSessionId(nextRepos, prev.worktreeId);
          return runtimeSessionId ? { worktreeId: prev.worktreeId, runtimeSessionId } : prev;
        });
      });
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
        setSelection((prev) => {
          if (prev?.worktreeId !== result.data.worktreeId) {
            return prev;
          }
          const runtimeSessionId = findActiveRuntimeSessionId(nextRepos, prev.worktreeId);
          return runtimeSessionId ? { worktreeId: prev.worktreeId, runtimeSessionId } : prev;
        });
      });
    },
    [refreshRepos, worktreeTarget],
  );

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
            onSelectActiveSession={(worktreeId, runtimeSessionId) =>
              setSelection({ worktreeId, runtimeSessionId })
            }
            onResumePrimarySession={handleResumePrimarySession}
            onResumeSuggestedSession={handleResumeSuggestedSession}
            onCreateSessionForWorktree={handleCreateSessionForWorktree}
          />
        </div>
      </aside>
      <div
        className="pane-resize-handle vertical"
        onMouseDown={handleSidebarResizeStart}
        aria-hidden="true"
      />
      {selectedWorktreeId && selectedRuntimeSessionId ? (
        <SessionView
          key={`${selectedWorktreeId}:${selectedRuntimeSessionId}`}
          appRef={appRef}
          onOpenExternal={openExternal}
          runtimeSessionId={selectedRuntimeSessionId}
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
    </div>
  );
}

function findTaskWorktree(
  repos: RepoListItem[],
  worktreeId: string | null,
): TaskWorktreeListItem | null {
  if (!worktreeId) {
    return null;
  }
  for (const repo of repos) {
    const taskWorktree = repo.taskWorktrees.find((entry) => entry.worktreeId === worktreeId);
    if (taskWorktree) {
      return taskWorktree;
    }
  }
  return null;
}

function findActiveRuntimeSessionId(
  repos: RepoListItem[],
  worktreeId: string,
): RuntimeSessionId | null {
  const taskWorktree = findTaskWorktree(repos, worktreeId);
  return (
    taskWorktree?.primarySession?.activeRuntimeSessionId ??
    taskWorktree?.suggestedSessions.find((session) => session.activeRuntimeSessionId)
      ?.activeRuntimeSessionId ??
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
