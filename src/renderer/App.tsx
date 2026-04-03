import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

interface Session {
  id: string;
  project: string;
  projectName: string;
  lastMessage: string;
  timestamp: number;
  state: "active" | "inactive" | "archived";
}

declare global {
  interface Window {
    electronAPI: {
      getSessions: () => Promise<Session[]>;
      selectSession: (session: Session) => void;
      onSessionEnded: (callback: (sessionId: string) => void) => void;
      ptyWrite: (data: string) => void;
      ptyResize: (cols: number, rows: number) => void;
      onPtyData: (callback: (data: string) => void) => void;
    };
  }
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  if (days === 1) {
    return "Yesterday";
  }
  if (days < 7) {
    return `${days}d ago`;
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function SessionList({
  sessions,
  selectedId,
  onSelect,
}: {
  sessions: Session[];
  selectedId: string | null;
  onSelect: (session: Session) => void;
}): JSX.Element {
  const activeSessions = sessions.filter((s) => s.state !== "archived");
  const archivedSessions = sessions.filter((s) => s.state === "archived");
  const [showArchived, setShowArchived] = useState(false);

  return (
    <div className="session-list">
      {activeSessions.map((session) => (
        <div
          key={session.id}
          className={`session-card ${selectedId === session.id ? "selected" : ""}`}
          onClick={() => onSelect(session)}
        >
          <div className="session-header">
            <span className="session-project">{session.projectName}</span>
            <span className={`session-state ${session.state}`}>{session.state}</span>
            <span className="session-time">{formatTime(session.timestamp)}</span>
          </div>
          <div className="session-preview">{session.lastMessage || "(no messages)"}</div>
        </div>
      ))}
      {archivedSessions.length > 0 && (
        <>
          <div className="archived-toggle" onClick={() => setShowArchived(!showArchived)}>
            {showArchived ? "▼" : "▶"} Archived ({archivedSessions.length})
          </div>
          {showArchived &&
            archivedSessions.map((session) => (
              <div key={session.id} className="session-card archived">
                <div className="session-header">
                  <span className="session-project">{session.projectName}</span>
                  <span className={`session-state ${session.state}`}>{session.state}</span>
                  <span className="session-time">{formatTime(session.timestamp)}</span>
                </div>
                <div className="session-preview">{session.lastMessage || "(no messages)"}</div>
              </div>
            ))}
        </>
      )}
    </div>
  );
}

export function App(): JSX.Element {
  const terminalRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Load sessions on mount
  useEffect(() => {
    window.electronAPI.getSessions().then(setSessions);
    window.electronAPI.onSessionEnded((sessionId) => {
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, state: "inactive" as const } : s)),
      );
      setSelectedId((prev) => (prev === sessionId ? null : prev));
    });
  }, []);

  // Setup terminal
  useEffect(() => {
    if (!terminalRef.current) {
      return;
    }

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "Menlo, Monaco, monospace",
      theme: {
        background: "#1e1e1e",
        foreground: "#d4d4d4",
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    term.onData((data) => {
      window.electronAPI.ptyWrite(data);
    });

    window.electronAPI.onPtyData((data) => {
      term.write(data);
    });

    term.onResize(({ cols, rows }) => {
      window.electronAPI.ptyResize(cols, rows);
    });

    const handleResize = (): void => {
      fitAddon.fit();
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      term.dispose();
    };
  }, []);

  const handleSelectSession = (session: Session): void => {
    if (session.state === "archived") {
      return;
    }
    setSelectedId(session.id);
    // Mark selected session as active in local state
    setSessions((prev) =>
      prev.map((s) => (s.id === session.id ? { ...s, state: "active" as const } : s)),
    );
    window.electronAPI.selectSession(session);
    // Clear and refit terminal after DOM updates
    requestAnimationFrame(() => {
      if (termRef.current && fitAddonRef.current) {
        termRef.current.clear();
        fitAddonRef.current.fit();
        termRef.current.focus();
        window.electronAPI.ptyResize(termRef.current.cols, termRef.current.rows);
      }
    });
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h2>Sessions</h2>
        </div>
        <SessionList sessions={sessions} selectedId={selectedId} onSelect={handleSelectSession} />
      </aside>
      <main className="terminal-container">
        <div
          ref={terminalRef}
          className="terminal"
          style={{ display: selectedId ? "block" : "none" }}
        />
        {!selectedId && (
          <div className="empty-state">
            <p>Select a session to resume</p>
          </div>
        )}
      </main>
    </div>
  );
}
