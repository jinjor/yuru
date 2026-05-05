import { type MouseEvent as ReactMouseEvent, useCallback, useEffect, useRef, useState } from "react";
import "@xterm/xterm/css/xterm.css";
import type { AgentDefinition } from "../shared/agent";
import type { PrimarySessionListItem, RepoListItem } from "../shared/metadata";
import { isRuntimeSessionKey, type SessionProvider } from "../shared/session";
import { BranchNameInput } from "./components/BranchNameInput";
import { RepoList } from "./components/RepoList";
import { SessionView } from "./components/SessionView";
import { clamp } from "./utils/layout";

function findPrimarySessionByRuntimeSessionId(
  repos: readonly RepoListItem[],
  runtimeSessionId: string,
): PrimarySessionListItem | null {
  for (const repo of repos) {
    for (const taskWorktree of repo.taskWorktrees) {
      const primarySession = taskWorktree.primarySession;
      if (primarySession?.activeRuntimeSessionId === runtimeSessionId) {
        return primarySession;
      }
    }
  }
  return null;
}

function reconcileSelectedRuntimeSessionId(
  repos: readonly RepoListItem[],
  selectedRuntimeSessionId: string | null,
): string | null {
  if (!selectedRuntimeSessionId) {
    return null;
  }

  if (findPrimarySessionByRuntimeSessionId(repos, selectedRuntimeSessionId)) {
    return selectedRuntimeSessionId;
  }

  return isRuntimeSessionKey(selectedRuntimeSessionId) ? selectedRuntimeSessionId : null;
}

export function App() {
  const appRef = useRef<HTMLDivElement>(null);
  const resumeRequestRef = useRef(0);
  const [repos, setRepos] = useState<RepoListItem[]>([]);
  const [availableProviders, setAvailableProviders] = useState<AgentDefinition[]>([]);
  const [selectedRuntimeSessionId, setSelectedRuntimeSessionId] = useState<string | null>(null);
  const [worktreeTarget, setWorktreeTarget] = useState<string | null>(null);
  const [worktreeError, setWorktreeError] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const selectedPrimarySessionKey = selectedRuntimeSessionId
    ? findPrimarySessionByRuntimeSessionId(repos, selectedRuntimeSessionId)?.providerSessionKey ?? null
    : null;

  const refreshRepos = useCallback((): void => {
    window.electronAPI
      .getRepos()
      .then((nextRepos) => {
        setRepos(nextRepos);
        setSelectedRuntimeSessionId((prev) => reconcileSelectedRuntimeSessionId(nextRepos, prev));
      })
      .catch((error) => {
        console.error("Failed to load repos.", error);
      });
  }, []);

  const openExternal = useCallback((url: string): void => {
    void window.electronAPI.openExternal(url);
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

    refreshRepos();
    window.electronAPI.onSessionsStateChanged(() => {
      refreshRepos();
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

  const handleSelectPrimarySession = useCallback(
    async (taskWorktreeId: string, providerSessionKey: string): Promise<void> => {
      const requestId = ++resumeRequestRef.current;
      const result = await window.electronAPI.selectWorktreeSession(
        taskWorktreeId,
        providerSessionKey,
      );
      if (resumeRequestRef.current !== requestId) {
        return;
      }
      if (!result.ok) {
        return;
      }

      const session = result.data;
      setSelectedRuntimeSessionId(session.id);
      refreshRepos();
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

      const session = result.data;
      setSelectedRuntimeSessionId(session.id);
      setWorktreeTarget(null);
      refreshRepos();
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
            selectedPrimarySessionKey={selectedPrimarySessionKey}
            onCreateWorktreeSession={(repoPath) => {
              setWorktreeError(null);
              setWorktreeTarget(repoPath);
            }}
            onSelectPrimarySession={handleSelectPrimarySession}
          />
        </div>
      </aside>
      <div
        className="pane-resize-handle vertical"
        onMouseDown={handleSidebarResizeStart}
        aria-hidden="true"
      />
      {selectedRuntimeSessionId ? (
        <SessionView
          key={selectedRuntimeSessionId}
          appRef={appRef}
          onOpenExternal={openExternal}
          refreshRepos={refreshRepos}
          runtimeSessionId={selectedRuntimeSessionId}
          sidebarWidth={sidebarWidth}
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

function SessionPlaceholder() {
  return (
    <main className="terminal-container">
      <div className="empty-state terminal-empty-state">
        <p>Select a session to resume</p>
      </div>
    </main>
  );
}
