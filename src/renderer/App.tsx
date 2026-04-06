import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Tree, NodeRendererProps } from "react-arborist";
import { ChevronDown, ChevronRight } from "lucide-react";
import "@xterm/xterm/css/xterm.css";

interface Session {
  id: string;
  project: string;
  projectName: string;
  repoPath: string;
  lastMessage: string;
  timestamp: number;
  state: "active" | "inactive" | "archived";
  worktree?: {
    name: string;
    branch: string;
  };
}

interface GitFileStatus {
  path: string;
  status: string;
}

interface FileTreeNode {
  id: string;
  path: string;
  name: string;
  kind: "file" | "directory";
  children: FileTreeNode[] | null;
}

interface FileContent {
  path: string;
  content: string;
  isBinary: boolean;
  size: number;
}

interface PreviewSelection {
  kind: "diff" | "file";
  path: string;
}

declare global {
  interface Window {
    electronAPI: {
      getSessions: () => Promise<Session[]>;
      selectSession: (session: Session) => void;
      createSession: (repoPath: string) => Promise<Session>;
      createWorktreeSession: (repoPath: string, branchName: string) => Promise<Session>;
      removeWorktree: (repoPath: string, worktreePath: string) => Promise<void>;
      selectFolder: () => Promise<string | null>;
      getGitStatus: (sessionId: string) => Promise<GitFileStatus[]>;
      getGitDiff: (sessionId: string, filePath: string) => Promise<string>;
      listFiles: (sessionId: string, relativePath?: string) => Promise<FileTreeNode[]>;
      readFile: (sessionId: string, filePath: string) => Promise<FileContent | null>;
      onSessionsStateChanged: (
        callback: (active: { sessionId: string; cwd: string }[]) => void,
      ) => void;
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

const CodeViewer = lazy(async () => import("./CodeViewer").then((module) => ({ default: module.CodeViewer })));

function useElementSize<T extends HTMLElement>(): [React.RefObject<T | null>, { width: number; height: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }

    const updateSize = (): void => {
      setSize({
        width: element.clientWidth,
        height: element.clientHeight,
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, size];
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
  deletingSessionId,
  onDeleteWorktree,
}: {
  sessions: Session[];
  selectedId: string | null;
  onSelect: (session: Session) => void;
  deletingSessionId: string | null;
  onDeleteWorktree: (session: Session) => void;
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
            <span className="session-project">{session.repoPath.split("/").pop()}</span>
            <span className={`session-state ${session.state}`} title={session.state} />
            <span className="session-time">{formatTime(session.timestamp)}</span>
          </div>
          {session.worktree && <div className="session-branch">{session.worktree.branch}</div>}
          {session.worktree && session.state === "inactive" && (
            <button
              className="session-delete-btn"
              onClick={(event) => {
                event.stopPropagation();
                onDeleteWorktree(session);
              }}
              disabled={deletingSessionId === session.id}
            >
              {deletingSessionId === session.id ? "Removing..." : "Remove worktree"}
            </button>
          )}
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

function FileTreeRow({ node, style, dragHandle }: NodeRendererProps<FileTreeNode>): JSX.Element {
  const isDirectory = node.data.kind === "directory";

  return (
    <div
      ref={dragHandle}
      style={style}
      className={`file-tree-row ${node.isSelected ? "selected" : ""}`}
      onClick={() => {
        if (isDirectory) {
          node.toggle();
        } else {
          node.select();
          node.activate();
        }
      }}
    >
      <span className={`file-tree-caret ${isDirectory ? "directory" : "file"}`}>
        {isDirectory ? (
          node.isOpen ? (
            <ChevronDown size={15} strokeWidth={2.4} />
          ) : (
            <ChevronRight size={15} strokeWidth={2.4} />
          )
        ) : null}
      </span>
      <span className={`file-tree-name ${node.data.kind}`}>{node.data.name}</span>
    </div>
  );
}

function replaceNodeChildren(
  nodes: FileTreeNode[],
  targetPath: string,
  nextChildren: FileTreeNode[],
): FileTreeNode[] {
  return nodes.map((node) => {
    if (node.path === targetPath) {
      return {
        ...node,
        children: nextChildren,
      };
    }
    if (!node.children || node.children.length === 0) {
      return node;
    }
    return {
      ...node,
      children: replaceNodeChildren(node.children, targetPath, nextChildren),
    };
  });
}

function ExplorerPanel({
  activeTab,
  onChangeTab,
  files,
  selectedDiffFile,
  onSelectDiffFile,
  treeData,
  selectedTreeFile,
  onSelectTreeFile,
  onToggleDirectory,
  treeLoading,
}: {
  activeTab: "changes" | "files";
  onChangeTab: (tab: "changes" | "files") => void;
  files: GitFileStatus[];
  selectedDiffFile: string | null;
  onSelectDiffFile: (filePath: string) => void;
  treeData: FileTreeNode[];
  selectedTreeFile: string | null;
  onSelectTreeFile: (filePath: string) => void;
  onToggleDirectory: (path: string) => void;
  treeLoading: boolean;
}): JSX.Element {
  const [panelRef, panelSize] = useElementSize<HTMLDivElement>();
  const [headerRef, headerSize] = useElementSize<HTMLDivElement>();
  const treeHeight = Math.max(panelSize.height - headerSize.height, 0);

  return (
    <aside ref={panelRef} className="changes-panel">
      <div ref={headerRef} className="panel-header">
        <div className="panel-tabs">
          <button
            className={`panel-tab ${activeTab === "changes" ? "active" : ""}`}
            onClick={() => onChangeTab("changes")}
          >
            Changes
          </button>
          <button
            className={`panel-tab ${activeTab === "files" ? "active" : ""}`}
            onClick={() => onChangeTab("files")}
          >
            Files
          </button>
        </div>
      </div>
      {activeTab === "changes" ? (
        <div className="changes-list">
          {files.length === 0 && <div className="empty-changes">No changes</div>}
          {files.map((file) => (
            <div
              key={file.path}
              className={`change-item ${selectedDiffFile === file.path ? "selected" : ""}`}
              onClick={() => onSelectDiffFile(file.path)}
            >
              <span className="change-status" style={{ color: statusColor(file.status) }}>
                {statusLabel(file.status)}
              </span>
              <span className="change-path" title={file.path}>
                {file.path.split("/").pop()}
              </span>
              <span className="change-dir" title={file.path}>
                {file.path.includes("/") ? file.path.substring(0, file.path.lastIndexOf("/")) : ""}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="file-tree">
          {treeLoading && treeData.length === 0 ? (
            <div className="empty-changes">Loading files...</div>
          ) : treeData.length === 0 ? (
            <div className="empty-changes">No files</div>
          ) : (
            <Tree<FileTreeNode>
              data={treeData}
              width="100%"
              height={treeHeight || 400}
              rowHeight={28}
              indent={12}
              openByDefault={false}
              selection={selectedTreeFile ?? undefined}
              disableDrag
              disableEdit
              onActivate={(node) => {
                if (node.data.kind === "file") {
                  onSelectTreeFile(node.data.path);
                }
              }}
              onToggle={onToggleDirectory}
            >
              {FileTreeRow}
            </Tree>
          )}
        </div>
      )}
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

function generateDefaultBranch(): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  return `work-${mm}${dd}-${hh}${min}`;
}

function BranchNameInput({
  onSubmit,
  onCancel,
  error,
}: {
  onSubmit: (branchName: string) => void;
  onCancel: () => void;
  error: string | null;
}): JSX.Element {
  const [name, setName] = useState(generateDefaultBranch);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.select();
    }
  }, []);

  const isValid = /^[a-zA-Z0-9._/-]+$/.test(name.trim()) && !name.trim().endsWith("/");

  const handleSubmit = (): void => {
    const trimmed = name.trim();
    if (trimmed && isValid) {
      onSubmit(trimmed);
    }
  };

  return (
    <div className="repo-picker-overlay" onClick={onCancel}>
      <div className="repo-picker" onClick={(e) => e.stopPropagation()}>
        <div className="repo-picker-header">Branch Name</div>
        <div className="worktree-input-row">
          <input
            ref={inputRef}
            type="text"
            className="worktree-name-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleSubmit();
              } else if (e.key === "Escape") {
                onCancel();
              }
            }}
            autoFocus
          />
          <button className="worktree-create-btn" onClick={handleSubmit} disabled={!isValid}>
            Create
          </button>
        </div>
        {name.trim() && !isValid && (
          <div className="worktree-error">
            Letters, digits, dots, underscores, slashes, dashes only
          </div>
        )}
        {error && <div className="worktree-error">{error}</div>}
      </div>
    </div>
  );
}

function RepoPicker({
  repos,
  onSelect,
  onSelectWorktree,
  onCancel,
}: {
  repos: string[];
  onSelect: (repoPath: string) => void;
  onSelectWorktree: (repoPath: string) => void;
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
          <div key={repo} className="repo-picker-repo">
            <div className="repo-picker-item" onClick={() => onSelect(repo)}>
              {repo.split("/").pop()}
              <span className="repo-picker-path">{repo}</span>
            </div>
            <button
              className="repo-picker-worktree-btn"
              onClick={() => onSelectWorktree(repo)}
              title="New session in worktree"
            >
              WT
            </button>
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
  const [worktreeRepo, setWorktreeRepo] = useState<string | null>(null);
  const [worktreeError, setWorktreeError] = useState<string | null>(null);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [changedFiles, setChangedFiles] = useState<GitFileStatus[]>([]);
  const [activeExplorerTab, setActiveExplorerTab] = useState<"changes" | "files">("changes");
  const [previewSelection, setPreviewSelection] = useState<PreviewSelection | null>(null);
  const [diffContent, setDiffContent] = useState<string | null>(null);
  const [treeData, setTreeData] = useState<FileTreeNode[]>([]);
  const [loadingDirectories, setLoadingDirectories] = useState<Set<string>>(new Set());
  const [fileContent, setFileContent] = useState<FileContent | null>(null);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const loadedDirectoriesRef = useRef<Set<string>>(new Set());
  const loadingDirectoriesRef = useRef<Set<string>>(new Set());

  const knownRepos = [...new Set(sessions.map((s) => s.repoPath))];

  const hideAllTerminals = useCallback((): void => {
    for (const instance of terminalsRef.current.values()) {
      instance.container.style.display = "none";
    }
  }, []);

  const resetTerminal = useCallback((sessionId: string): void => {
    const instance = terminalsRef.current.get(sessionId);
    if (instance) {
      instance.term.reset();
    }
  }, []);

  const getOrCreateTerminal = useCallback((sessionId: string): TerminalInstance => {
    const existing = terminalsRef.current.get(sessionId);
    if (existing) {
      return existing;
    }

    const container = document.createElement("div");
    container.className = "terminal";
    container.style.display = "none";

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 12,
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
  }, []);

  const refreshSessions = useCallback((): void => {
    window.electronAPI.getSessions().then((nextSessions) => {
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
    });
  }, []);

  const resetFileExplorerState = useCallback((): void => {
    setTreeData([]);
    loadedDirectoriesRef.current = new Set();
    loadingDirectoriesRef.current = new Set();
    setLoadingDirectories(loadingDirectoriesRef.current);
    setFileContent(null);
    setIsLoadingFile(false);
  }, []);

  const loadDirectory = useCallback(
    async (relativePath = ""): Promise<void> => {
      if (!selectedId) {
        return;
      }
      if (
        loadedDirectoriesRef.current.has(relativePath) ||
        loadingDirectoriesRef.current.has(relativePath)
      ) {
        return;
      }

      loadingDirectoriesRef.current = new Set(loadingDirectoriesRef.current).add(relativePath);
      setLoadingDirectories(loadingDirectoriesRef.current);
      try {
        const nextNodes = await window.electronAPI.listFiles(selectedId, relativePath);
        setTreeData((prev) => (relativePath ? replaceNodeChildren(prev, relativePath, nextNodes) : nextNodes));
        loadedDirectoriesRef.current = new Set(loadedDirectoriesRef.current).add(relativePath);
      } finally {
        const nextLoadingDirectories = new Set(loadingDirectoriesRef.current);
        nextLoadingDirectories.delete(relativePath);
        loadingDirectoriesRef.current = nextLoadingDirectories;
        setLoadingDirectories(nextLoadingDirectories);
      }
    },
    [selectedId],
  );

  // Load sessions and setup listeners
  useEffect(() => {
    refreshSessions();

    window.electronAPI.onPtyData((sessionId, data) => {
      const instance = terminalsRef.current.get(sessionId);
      if (instance) {
        instance.term.write(data);
      }
    });

    window.electronAPI.onSessionsStateChanged(() => {
      refreshSessions();
    });
  }, [refreshSessions]);

  useEffect(() => {
    if (!selectedId) {
      hideAllTerminals();
    }
  }, [hideAllTerminals, selectedId]);

  // Polling: git status every 3 seconds for selected session
  useEffect(() => {
    if (!selectedId) {
      setChangedFiles([]);
      setPreviewSelection(null);
      setDiffContent(null);
      resetFileExplorerState();
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
      setPreviewSelection((prev) => {
        if (prev?.kind === "diff" && !files.some((f) => f.path === prev.path)) {
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
  }, [resetFileExplorerState, selectedId]);

  useEffect(() => {
    if (!selectedId) {
      return;
    }

    resetFileExplorerState();
    void loadDirectory("");
  }, [selectedId, loadDirectory, resetFileExplorerState]);

  // Fetch diff when selected file changes
  useEffect(() => {
    if (!selectedId || previewSelection?.kind !== "diff") {
      setDiffContent(null);
      return;
    }

    let cancelled = false;
    const fetchDiff = async (): Promise<void> => {
      const diff = await window.electronAPI.getGitDiff(selectedId, previewSelection.path);
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
  }, [previewSelection, selectedId]);

  useEffect(() => {
    if (!selectedId || previewSelection?.kind !== "file") {
      setFileContent(null);
      setIsLoadingFile(false);
      return;
    }

    let cancelled = false;
    setIsLoadingFile(true);
    window.electronAPI.readFile(selectedId, previewSelection.path).then((nextContent) => {
      if (cancelled) {
        return;
      }
      setFileContent(nextContent);
      setIsLoadingFile(false);
    });

    return () => {
      cancelled = true;
    };
  }, [previewSelection, selectedId]);

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
      window.electronAPI.ptyResize(sessionId, instance.term.cols, instance.term.rows);
    });
  };

  const handleSelectSession = (session: Session): void => {
    if (session.state === "archived") {
      return;
    }
    if (session.state === "inactive") {
      resetTerminal(session.id);
    }

    window.electronAPI.selectSession(session);
    setPreviewSelection(null);
    setDiffContent(null);
    showTerminal(session.id);
  };

  const handleCreateSession = async (repoPath: string): Promise<void> => {
    setShowRepoPicker(false);
    setIsCreatingSession(true);
    try {
      const session = await window.electronAPI.createSession(repoPath);
      setSessions((prev) => [session, ...prev]);
      setPreviewSelection(null);
      setDiffContent(null);
      showTerminal(session.id);
    } finally {
      setIsCreatingSession(false);
    }
  };

  const handleCreateWorktreeSession = async (branchName: string): Promise<void> => {
    if (!worktreeRepo) {
      return;
    }
    const repoPath = worktreeRepo;
    setWorktreeError(null);
    setIsCreatingSession(true);
    try {
      const session = await window.electronAPI.createWorktreeSession(repoPath, branchName);
      setWorktreeRepo(null);
      setSessions((prev) => [session, ...prev]);
      setPreviewSelection(null);
      setDiffContent(null);
      showTerminal(session.id);
    } catch (e) {
      setWorktreeError(e instanceof Error ? e.message : "Failed to create worktree");
    } finally {
      setIsCreatingSession(false);
    }
  };

  const handleDeleteWorktree = async (session: Session): Promise<void> => {
    if (!session.worktree || session.state !== "inactive") {
      return;
    }
    const confirmed = window.confirm(
      `Remove worktree "${session.worktree.name}" for ${session.repoPath.split("/").pop()}?`,
    );
    if (!confirmed) {
      return;
    }
    setDeletingSessionId(session.id);
    try {
      await window.electronAPI.removeWorktree(session.repoPath, session.project);
    } catch (error) {
      setDeletingSessionId(null);
      window.alert(error instanceof Error ? error.message : "Failed to remove worktree");
    }
  };

  const handleSelectDiffFile = (filePath: string): void => {
    setPreviewSelection({ kind: "diff", path: filePath });
  };

  const handleSelectTreeFile = (filePath: string): void => {
    setPreviewSelection({ kind: "file", path: filePath });
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h2>Sessions</h2>
          <button className="new-session-btn" onClick={() => setShowRepoPicker(true)}>
            +
          </button>
        </div>
        <SessionList
          sessions={sessions}
          selectedId={selectedId}
          onSelect={handleSelectSession}
          deletingSessionId={deletingSessionId}
          onDeleteWorktree={handleDeleteWorktree}
        />
      </aside>
      <main className="terminal-container">
        <div ref={containerRef} className="terminal-host" />
        {isCreatingSession && !selectedId && (
          <div className="empty-state terminal-empty-state">
            <p>Starting session...</p>
          </div>
        )}
        {!isCreatingSession && !selectedId && (
          <div className="empty-state terminal-empty-state">
            <p>Select a session to resume</p>
          </div>
        )}
      </main>
      {selectedId && (
        <>
          <ExplorerPanel
            activeTab={activeExplorerTab}
            onChangeTab={setActiveExplorerTab}
            files={changedFiles}
            selectedDiffFile={previewSelection?.kind === "diff" ? previewSelection.path : null}
            onSelectDiffFile={handleSelectDiffFile}
            treeData={treeData}
            selectedTreeFile={previewSelection?.kind === "file" ? previewSelection.path : null}
            onSelectTreeFile={handleSelectTreeFile}
            onToggleDirectory={(path) => {
              void loadDirectory(path);
            }}
            treeLoading={loadingDirectories.has("")}
          />
          <div className="preview-panel">
            <div className="panel-header preview-header">
              <h2>{previewSelection?.kind === "file" ? "Code" : "Diff"}</h2>
              {previewSelection && <span className="preview-path">{previewSelection.path}</span>}
            </div>
            <div className="preview-body">
              {previewSelection?.kind === "file" ? (
                <Suspense
                  fallback={
                    <div className="code-panel-empty">
                      <p>Loading editor...</p>
                    </div>
                  }
                >
                  <CodeViewer
                    content={fileContent?.content ?? null}
                    filePath={fileContent?.path ?? previewSelection.path}
                    fileSize={fileContent?.size ?? null}
                    isBinary={fileContent?.isBinary ?? false}
                    isLoading={isLoadingFile}
                  />
                </Suspense>
              ) : (
                <DiffPanel diff={diffContent} />
              )}
            </div>
          </div>
        </>
      )}
      {showRepoPicker && (
        <RepoPicker
          repos={knownRepos}
          onSelect={handleCreateSession}
          onSelectWorktree={(repo) => {
            setShowRepoPicker(false);
            setWorktreeRepo(repo);
            setWorktreeError(null);
          }}
          onCancel={() => setShowRepoPicker(false)}
        />
      )}
      {worktreeRepo && (
        <BranchNameInput
          onSubmit={handleCreateWorktreeSession}
          onCancel={() => setWorktreeRepo(null)}
          error={worktreeError}
        />
      )}
    </div>
  );
}
