import { type MouseEvent as ReactMouseEvent, useCallback, useEffect, useRef, useState } from "react";
import "@xterm/xterm/css/xterm.css";
import type { AgentDefinition } from "../shared/agent";
import type { PrimarySessionListItem, RepoListItem, TaskWorktreeListItem } from "../shared/metadata";
import { type Session, type SessionProvider, toSessionKey } from "../shared/session";
import { BranchNameInput } from "./components/BranchNameInput";
import { RepoList } from "./components/RepoList";
import { SessionView } from "./components/SessionView";
import { clamp } from "./utils/layout";

interface SelectedSession {
  sessionId: string;
  primarySessionKey: string | null;
}

function appSessionIdForPrimarySession(primarySession: PrimarySessionListItem): string {
  return primarySession.activeAppSessionId ?? primarySession.providerSessionKey;
}

function sessionFromPrimarySession(
  repo: RepoListItem,
  taskWorktree: TaskWorktreeListItem,
): Session | null {
  const primarySession = taskWorktree.primarySession;
  if (!primarySession) {
    return null;
  }

  return {
    id: appSessionIdForPrimarySession(primarySession),
    provider: primarySession.provider,
    providerSessionId: primarySession.providerSessionId,
    project: taskWorktree.worktreePath,
    projectName: taskWorktree.name,
    repoPath: repo.repoPath,
    lastMessage: primarySession.preview,
    timestamp: Date.now(),
    state: primarySession.state,
  };
}

function findPrimarySessionByKey(
  repos: readonly RepoListItem[],
  primarySessionKey: string,
): PrimarySessionListItem | null {
  for (const repo of repos) {
    for (const taskWorktree of repo.taskWorktrees) {
      const primarySession = taskWorktree.primarySession;
      if (primarySession?.providerSessionKey === primarySessionKey) {
        return primarySession;
      }
    }
  }
  return null;
}

function findPrimarySessionByActiveAppSessionId(
  repos: readonly RepoListItem[],
  activeAppSessionId: string,
): PrimarySessionListItem | null {
  for (const repo of repos) {
    for (const taskWorktree of repo.taskWorktrees) {
      const primarySession = taskWorktree.primarySession;
      if (primarySession?.activeAppSessionId === activeAppSessionId) {
        return primarySession;
      }
    }
  }
  return null;
}

function reconcileSelectedSession(
  repos: readonly RepoListItem[],
  selectedSession: SelectedSession | null,
): SelectedSession | null {
  if (!selectedSession) {
    return null;
  }

  if (!selectedSession.primarySessionKey) {
    const primarySession = findPrimarySessionByActiveAppSessionId(
      repos,
      selectedSession.sessionId,
    );
    return primarySession
      ? {
          sessionId: appSessionIdForPrimarySession(primarySession),
          primarySessionKey: primarySession.providerSessionKey,
        }
      : selectedSession;
  }

  const primarySession = findPrimarySessionByKey(repos, selectedSession.primarySessionKey);
  if (!primarySession || !primarySession.activeAppSessionId) {
    return null;
  }

  return {
    sessionId: primarySession.activeAppSessionId,
    primarySessionKey: primarySession.providerSessionKey,
  };
}

export function App() {
  const appRef = useRef<HTMLDivElement>(null);
  const resumeRequestRef = useRef(0);
  const [repos, setRepos] = useState<RepoListItem[]>([]);
  const [availableProviders, setAvailableProviders] = useState<AgentDefinition[]>([]);
  const [selectedSession, setSelectedSession] = useState<SelectedSession | null>(null);
  const [worktreeTarget, setWorktreeTarget] = useState<string | null>(null);
  const [worktreeError, setWorktreeError] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const selectedSessionId = selectedSession?.sessionId ?? null;
  const selectedPrimarySessionKey = selectedSession?.primarySessionKey ?? null;

  const refreshRepos = useCallback((): void => {
    window.electronAPI
      .getRepos()
      .then((nextRepos) => {
        setRepos(nextRepos);
        setSelectedSession((prev) => reconcileSelectedSession(nextRepos, prev));
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
        const reservedSessionViewWidth = selectedSessionId ? 520 : 640;
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
    [selectedSessionId, sidebarWidth],
  );

  const handleSelectPrimarySession = useCallback(
    async (repo: RepoListItem, taskWorktree: TaskWorktreeListItem): Promise<void> => {
      const primarySession = taskWorktree.primarySession;
      if (!primarySession) {
        return;
      }
      const session = sessionFromPrimarySession(repo, taskWorktree);
      if (!session) {
        return;
      }

      const requestId = ++resumeRequestRef.current;
      const result = await window.electronAPI.selectSession(session);
      if (resumeRequestRef.current !== requestId) {
        return;
      }
      if (!result.ok) {
        return;
      }

      setSelectedSession({
        sessionId: session.id,
        primarySessionKey: primarySession.providerSessionKey,
      });
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
      setSelectedSession({
        sessionId: session.id,
        primarySessionKey: session.providerSessionId
          ? toSessionKey(session.provider, session.providerSessionId)
          : null,
      });
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
      {selectedSessionId ? (
        <SessionView
          key={selectedSessionId}
          appRef={appRef}
          onOpenExternal={openExternal}
          refreshRepos={refreshRepos}
          sessionId={selectedSessionId}
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
