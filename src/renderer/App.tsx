import { useCallback, useEffect, useRef, useState } from "react";
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

interface GitFileStatus {
  path: string;
  status: string;
}

declare global {
  interface Window {
    electronAPI: {
      getSessions: () => Promise<Session[]>;
      selectSession: (session: Session) => void;
      createSession: (repoPath: string) => Promise<Session>;
      selectFolder: () => Promise<string | null>;
      getGitStatus: (sessionId: string) => Promise<GitFileStatus[]>;
      getGitDiff: (sessionId: string, filePath: string) => Promise<string>;
      onSessionEnded: (callback: (sessionId: string) => void) => void;
      ptyWrite: (sessionId: string, data: string) => void;
      ptyResize: (sessionId: string, cols: number, rows: number) => void;
      onPtyData: (callback: (sessionId: string, data: string) => void) => void;
    };
  }
}

interface TerminalInstance {
  term: Terminal;
  fitAddon: FitAddon;
  container: HTMLDivElement;
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

function statusColor(status: string): string {
  switch (status) {
    case "M":
      return "#e2c08d";
    case "A":
      return "#73c991";
    case "D":
      return "#c74e39";
    case "R":
      return "#73c991";
    case "??":
      return "#73c991";
    default:
      return "#888";
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case "??":
      return "U";
    default:
      return status;
  }
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
            <span className={`session-state ${session.state}`}>
              {session.state}
            </span>
            <span className="session-time">
              {formatTime(session.timestamp)}
            </span>
          </div>
          <div className="session-preview">
            {session.lastMessage || "(no messages)"}
          </div>
        </div>
      ))}
      {archivedSessions.length > 0 && (
        <>
          <div
            className="archived-toggle"
            onClick={() => setShowArchived(!showArchived)}
          >
            {showArchived ? "▼" : "▶"} Archived ({archivedSessions.length})
          </div>
          {showArchived &&
            archivedSessions.map((session) => (
              <div key={session.id} className="session-card archived">
                <div className="session-header">
                  <span className="session-project">{session.projectName}</span>
                  <span className={`session-state ${session.state}`}>
                    {session.state}
                  </span>
                  <span className="session-time">
                    {formatTime(session.timestamp)}
                  </span>
                </div>
                <div className="session-preview">
                  {session.lastMessage || "(no messages)"}
                </div>
              </div>
            ))}
        </>
      )}
    </div>
  );
}

function ChangesPanel({
  files,
  selectedFile,
  onSelectFile,
}: {
  files: GitFileStatus[];
  selectedFile: string | null;
  onSelectFile: (filePath: string) => void;
}): JSX.Element {
  return (
    <aside className="changes-panel">
      <div className="panel-header">
        <h2>Changes</h2>
        <span className="change-count">{files.length}</span>
      </div>
      <div className="changes-list">
        {files.length === 0 && <div className="empty-changes">No changes</div>}
        {files.map((file) => (
          <div
            key={file.path}
            className={`change-item ${selectedFile === file.path ? "selected" : ""}`}
            onClick={() => onSelectFile(file.path)}
          >
            <span
              className="change-status"
              style={{ color: statusColor(file.status) }}
            >
              {statusLabel(file.status)}
            </span>
            <span className="change-path" title={file.path}>
              {file.path.split("/").pop()}
            </span>
            <span className="change-dir" title={file.path}>
              {file.path.includes("/")
                ? file.path.substring(0, file.path.lastIndexOf("/"))
                : ""}
            </span>
          </div>
        ))}
      </div>
    </aside>
  );
}

function DiffPanel({ diff }: { diff: string | null }): JSX.Element {
  if (!diff) {
    return (
      <div className="diff-panel">
        <div className="empty-state">
          <p>Select a file to view diff</p>
        </div>
      </div>
    );
  }

  const lines = diff.split("\n");
  return (
    <div className="diff-panel">
      <pre className="diff-content">
        {lines.map((line, i) => {
          let className = "diff-line";
          if (line.startsWith("+") && !line.startsWith("+++")) {
            className += " diff-add";
          } else if (line.startsWith("-") && !line.startsWith("---")) {
            className += " diff-remove";
          } else if (line.startsWith("@@")) {
            className += " diff-hunk";
          }
          return (
            <div key={i} className={className}>
              {line}
            </div>
          );
        })}
      </pre>
    </div>
  );
}

function RepoPicker({
  repos,
  onSelect,
  onCancel,
}: {
  repos: string[];
  onSelect: (repoPath: string) => void;
  onCancel: () => void;
}): JSX.Element {
  const handleBrowse = async (): Promise<void> => {
    const folderPath = await window.electronAPI.selectFolder();
    if (folderPath) {
      onSelect(folderPath);
    }
  };

  return (
    <div className="repo-picker-overlay" onClick={onCancel}>
      <div className="repo-picker" onClick={(e) => e.stopPropagation()}>
        <div className="repo-picker-header">New Session</div>
        {repos.map((repo) => (
          <div
            key={repo}
            className="repo-picker-item"
            onClick={() => onSelect(repo)}
          >
            {repo.split("/").pop()}
            <span className="repo-picker-path">{repo}</span>
          </div>
        ))}
        <div className="repo-picker-item browse" onClick={handleBrowse}>
          Browse...
        </div>
      </div>
    </div>
  );
}

export function App(): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalsRef = useRef<Map<string, TerminalInstance>>(new Map());
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showRepoPicker, setShowRepoPicker] = useState(false);
  const [changedFiles, setChangedFiles] = useState<GitFileStatus[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [diffContent, setDiffContent] = useState<string | null>(null);

  const knownRepos = [...new Set(sessions.map((s) => s.project))];

  const getOrCreateTerminal = useCallback(
    (sessionId: string): TerminalInstance => {
      const existing = terminalsRef.current.get(sessionId);
      if (existing) {
        return existing;
      }

      const container = document.createElement("div");
      container.className = "terminal";
      container.style.display = "none";

      const term = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: "Menlo, Monaco, monospace",
        theme: {
          background: "#1e1e1e",
          foreground: "#d4d4d4",
        },
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);

      if (containerRef.current) {
        containerRef.current.appendChild(container);
      }
      term.open(container);

      term.attachCustomKeyEventHandler((event) => {
        if (event.key === "Enter" && event.shiftKey) {
          if (event.type === "keydown") {
            event.preventDefault();
            event.stopPropagation();
            window.electronAPI.ptyWrite(sessionId, "\x1b[13;2u");
          }
          return false;
        }
        return true;
      });

      term.onData((data) => {
        window.electronAPI.ptyWrite(sessionId, data);
      });

      term.onResize(({ cols, rows }) => {
        window.electronAPI.ptyResize(sessionId, cols, rows);
      });

      const instance: TerminalInstance = { term, fitAddon, container };
      terminalsRef.current.set(sessionId, instance);
      return instance;
    },
    [],
  );

  // Load sessions and setup listeners
  useEffect(() => {
    window.electronAPI.getSessions().then(setSessions);

    window.electronAPI.onPtyData((sessionId, data) => {
      const instance = terminalsRef.current.get(sessionId);
      if (instance) {
        instance.term.write(data);
      }
    });

    window.electronAPI.onSessionEnded((sessionId) => {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId ? { ...s, state: "inactive" as const } : s,
        ),
      );
      setSelectedId((prev) => (prev === sessionId ? null : prev));
    });
  }, []);

  // Polling: git status every 3 seconds for selected session
  useEffect(() => {
    if (!selectedId) {
      setChangedFiles([]);
      setSelectedFile(null);
      setDiffContent(null);
      return;
    }

    let cancelled = false;
    const sessionId = selectedId;

    const fetchStatus = async (): Promise<void> => {
      const files = await window.electronAPI.getGitStatus(sessionId);
      if (cancelled) {
        return;
      }
      setChangedFiles((prev) => {
        if (JSON.stringify(prev) === JSON.stringify(files)) {
          return prev;
        }
        return files;
      });
      // Clear selected file if it's no longer in the list
      setSelectedFile((prev) => {
        if (prev && !files.some((f) => f.path === prev)) {
          return null;
        }
        return prev;
      });
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [selectedId]);

  // Fetch diff when selected file changes
  useEffect(() => {
    if (!selectedId || !selectedFile) {
      setDiffContent(null);
      return;
    }

    let cancelled = false;
    const fetchDiff = async (): Promise<void> => {
      const diff = await window.electronAPI.getGitDiff(
        selectedId,
        selectedFile,
      );
      if (!cancelled) {
        setDiffContent(diff);
      }
    };
    fetchDiff();

    // Also refresh diff on polling interval
    const interval = setInterval(fetchDiff, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [selectedId, selectedFile]);

  // Handle window resize — refit the active terminal
  useEffect(() => {
    const handleResize = (): void => {
      if (selectedId) {
        const instance = terminalsRef.current.get(selectedId);
        if (instance) {
          instance.fitAddon.fit();
        }
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [selectedId]);

  const showTerminal = (sessionId: string): void => {
    // Hide current terminal
    if (selectedId) {
      const current = terminalsRef.current.get(selectedId);
      if (current) {
        current.container.style.display = "none";
      }
    }

    setSelectedId(sessionId);

    const instance = getOrCreateTerminal(sessionId);
    instance.container.style.display = "block";
    requestAnimationFrame(() => {
      instance.fitAddon.fit();
      instance.term.focus();
      window.electronAPI.ptyResize(
        sessionId,
        instance.term.cols,
        instance.term.rows,
      );
    });
  };

  const handleSelectSession = (session: Session): void => {
    if (session.state === "archived") {
      return;
    }

    setSessions((prev) =>
      prev.map((s) =>
        s.id === session.id ? { ...s, state: "active" as const } : s,
      ),
    );
    window.electronAPI.selectSession(session);
    setSelectedFile(null);
    setDiffContent(null);
    showTerminal(session.id);
  };

  const handleCreateSession = async (repoPath: string): Promise<void> => {
    setShowRepoPicker(false);
    const session = await window.electronAPI.createSession(repoPath);
    setSessions((prev) => [session, ...prev]);
    setSelectedFile(null);
    setDiffContent(null);
    showTerminal(session.id);
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h2>Sessions</h2>
          <button
            className="new-session-btn"
            onClick={() => setShowRepoPicker(true)}
          >
            +
          </button>
        </div>
        <SessionList
          sessions={sessions}
          selectedId={selectedId}
          onSelect={handleSelectSession}
        />
      </aside>
      <main className="terminal-container">
        <div ref={containerRef} className="terminal-host" />
        {!selectedId && (
          <div className="empty-state">
            <p>Select a session to resume</p>
          </div>
        )}
      </main>
      {selectedId && (
        <>
          <ChangesPanel
            files={changedFiles}
            selectedFile={selectedFile}
            onSelectFile={setSelectedFile}
          />
          <DiffPanel diff={diffContent} />
        </>
      )}
      {showRepoPicker && (
        <RepoPicker
          repos={knownRepos}
          onSelect={handleCreateSession}
          onCancel={() => setShowRepoPicker(false)}
        />
      )}
    </div>
  );
}
