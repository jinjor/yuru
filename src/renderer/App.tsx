import { type MouseEvent as ReactMouseEvent, useCallback, useEffect, useRef, useState } from "react";
import "@xterm/xterm/css/xterm.css";
import type { AgentDefinition } from "../shared/agent";
import type { Session, SessionProvider } from "../shared/session";
import { BranchNameInput } from "./components/BranchNameInput";
import { RepoPicker } from "./components/RepoPicker";
import { SessionList } from "./components/SessionList";
import { Workspace } from "./components/Workspace";
import { clamp } from "./utils/layout";

export function App() {
  const appRef = useRef<HTMLDivElement>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [availableProviders, setAvailableProviders] = useState<AgentDefinition[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showRepoPicker, setShowRepoPicker] = useState(false);
  const [newSessionProvider, setNewSessionProvider] = useState<SessionProvider | null>(null);
  const [worktreeTarget, setWorktreeTarget] = useState<{
    repoPath: string;
    provider: SessionProvider;
  } | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);

  const refreshSessions = useCallback((): void => {
    window.electronAPI
      .getSessions()
      .then((nextSessions) => {
        setSessions(nextSessions);
        setDeletingSessionId((prev) => {
          if (!prev) {
            return null;
          }
          const deletingSession = nextSessions.find((session) => session.id === prev);
          if (!deletingSession || deletingSession.state !== "inactive" || !deletingSession.worktree) {
            return null;
          }
          return prev;
        });
        setSelectedId((prev) => {
          if (!prev) {
            return null;
          }
          const selectedSession = nextSessions.find((session) => session.id === prev);
          if (!selectedSession || selectedSession.state !== "active") {
            return null;
          }
          return prev;
        });
      })
      .catch((error) => {
        console.error("Failed to load sessions.", error);
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
        setNewSessionProvider((prev) => prev ?? providers[0]?.id ?? null);
      })
      .catch((error) => {
        console.error("Failed to load session providers.", error);
      });

    refreshSessions();
    window.electronAPI.onSessionsStateChanged(() => {
      refreshSessions();
    });
  }, [refreshSessions]);

  useEffect(() => {
    if (!availableProviders.some((provider) => provider.id === newSessionProvider)) {
      setNewSessionProvider(availableProviders[0]?.id ?? null);
    }
  }, [availableProviders, newSessionProvider]);

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
        const reservedWorkspaceWidth = selectedId ? 520 : 640;
        const maxWidth = Math.max(220, appWidth - reservedWorkspaceWidth);
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
    [selectedId, sidebarWidth],
  );

  const handleSelectSession = useCallback(
    async (session: Session): Promise<void> => {
      if (session.state === "archived") {
        return;
      }

      const result = await window.electronAPI.selectSession(session);
      if (!result.ok) {
        return;
      }

      setSelectedId(session.id);
    },
    [],
  );

  const handleCreateSession = useCallback(
    async (repoPath: string, provider: SessionProvider): Promise<void> => {
      setShowRepoPicker(false);
      setNewSessionProvider(provider);
      setIsCreatingSession(true);
      try {
        const result = await window.electronAPI.createSession(provider, repoPath);
        if (!result.ok) {
          return;
        }

        const session = result.data;
        setSessions((prev) => [session, ...prev]);
        setSelectedId(session.id);
      } finally {
        setIsCreatingSession(false);
      }
    },
    [],
  );

  const handleCreateWorktreeSession = useCallback(
    async (branchName: string): Promise<void> => {
      if (!worktreeTarget) {
        return;
      }

      const { repoPath, provider } = worktreeTarget;
      setWorktreeTarget(null);
      setNewSessionProvider(provider);
      setIsCreatingSession(true);
      try {
        const result = await window.electronAPI.createWorktreeSession(provider, repoPath, branchName);
        if (!result.ok) {
          return;
        }

        const session = result.data;
        setSessions((prev) => [session, ...prev]);
        setSelectedId(session.id);
      } finally {
        setIsCreatingSession(false);
      }
    },
    [worktreeTarget],
  );

  const handleDeleteWorktree = useCallback(async (session: Session): Promise<void> => {
    if (!session.worktree) {
      return;
    }

    const confirmed = window.confirm(
      `Remove worktree "${session.worktree.name}" for ${session.repoPath.split("/").pop()}?`,
    );
    if (!confirmed) {
      return;
    }

    setDeletingSessionId(session.id);
    const result = await window.electronAPI.removeWorktree(
      session.provider,
      session.repoPath,
      session.project,
    );
    if (!result.ok) {
      setDeletingSessionId(null);
    }
  }, []);

  const knownRepos = [...new Set(sessions.map((session) => session.repoPath))];
  return (
    <div className="app" ref={appRef}>
      <aside className="sidebar" style={{ width: sidebarWidth, minWidth: sidebarWidth }}>
        <div className="sidebar-header">
          <h2>Sessions</h2>
          <button className="new-session-btn" onClick={() => setShowRepoPicker(true)}>
            +
          </button>
        </div>
        <SessionList
          sessions={sessions}
          selectedId={selectedId}
          deletingSessionId={deletingSessionId}
          onDeleteWorktree={handleDeleteWorktree}
          onOpenExternal={openExternal}
          onSelect={handleSelectSession}
        />
      </aside>
      <div
        className="pane-resize-handle vertical"
        onMouseDown={handleSidebarResizeStart}
        aria-hidden="true"
      />
      <Workspace
        key={selectedId ?? "no-session"}
        appRef={appRef}
        isCreatingSession={isCreatingSession}
        onOpenExternal={openExternal}
        refreshSessions={refreshSessions}
        sessionId={selectedId}
        sidebarWidth={sidebarWidth}
      />
      {showRepoPicker && (
        <RepoPicker
          repos={knownRepos}
          providers={availableProviders}
          provider={newSessionProvider}
          onChangeProvider={setNewSessionProvider}
          onSelect={handleCreateSession}
          onSelectWorktree={(repo, provider) => {
            setShowRepoPicker(false);
            setNewSessionProvider(provider);
            setWorktreeTarget({ repoPath: repo, provider });
          }}
          onCancel={() => setShowRepoPicker(false)}
        />
      )}
      {worktreeTarget && (
        <BranchNameInput
          onSubmit={handleCreateWorktreeSession}
          onCancel={() => setWorktreeTarget(null)}
          error={null}
        />
      )}
    </div>
  );
}
