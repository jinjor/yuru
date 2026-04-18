import { FitAddon } from "@xterm/addon-fit";
import { Terminal, type IBufferRange, type ILink, type ILinkProvider } from "@xterm/xterm";
import { GitBranch } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import type { GitHubPullRequest } from "../../shared/session";
import { GitHubBadge } from "./GitHubBadge";

interface TerminalPanelProps {
  currentBranch: string | null;
  currentGitHub: GitHubPullRequest | null;
  fitDependencies: readonly unknown[];
  isCreatingSession: boolean;
  onFileLinkActivate: (filePath: string, line?: number) => void;
  onOpenExternal: (url: string) => void;
  selectedId: string | null;
}

interface TerminalInstance {
  term: Terminal;
  fitAddon: FitAddon;
  container: HTMLDivElement;
}

export function TerminalPanel({
  currentBranch,
  currentGitHub,
  fitDependencies,
  isCreatingSession,
  onFileLinkActivate,
  onOpenExternal,
  selectedId,
}: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<TerminalInstance | null>(null);
  const onFileLinkActivateRef = useRef(onFileLinkActivate);
  onFileLinkActivateRef.current = onFileLinkActivate;

  const fitTerminal = useCallback((): void => {
    if (!selectedId || !terminalRef.current) {
      return;
    }

    terminalRef.current.fitAddon.fit();
    window.electronAPI.ptyResize(
      selectedId,
      terminalRef.current.term.cols,
      terminalRef.current.term.rows,
    );
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId || !containerRef.current) {
      return;
    }

    const container = document.createElement("div");
    container.className = "terminal";
    container.style.display = "block";

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      fontFamily: "Menlo, Monaco, monospace",
      theme: {
        background: "#0f141c",
        foreground: "#d8e1ef",
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    containerRef.current.appendChild(container);
    term.open(container);

    const filePathPattern = /[\w./-][\w./-]*\.\w+(?::(\d+)(?::(\d+))?)?/g;

    term.registerLinkProvider({
      provideLinks(bufferLineNumber: number, callback: (links: ILink[] | undefined) => void): void {
        const line = term.buffer.active.getLine(bufferLineNumber - 1);
        if (!line) {
          callback(undefined);
          return;
        }

        const lineText = line.translateToString();
        const matches: { text: string; filePath: string; startIndex: number; fileLine?: number }[] = [];
        let match: RegExpExecArray | null;
        filePathPattern.lastIndex = 0;
        while ((match = filePathPattern.exec(lineText)) !== null) {
          const text = match[0];
          const filePath = text.replace(/:\d+(?::\d+)?$/, "");
          const lineMatch = text.match(/:(\d+)(?::\d+)?$/);
          const fileLine = lineMatch ? parseInt(lineMatch[1], 10) : undefined;
          if (filePath.includes("/") || filePath.includes(".")) {
            matches.push({ text, filePath, startIndex: match.index, fileLine });
          }
        }

        if (matches.length === 0) {
          callback(undefined);
          return;
        }

        Promise.all(
          matches.map(async (entry): Promise<ILink | null> => {
            const exists = await window.electronAPI.fileExists(selectedId, entry.filePath);
            if (!exists) {
              return null;
            }

            const cellStart = stringIndexToCellIndex(line, entry.startIndex);
            const cellEnd = stringIndexToCellIndex(line, entry.startIndex + entry.text.length);
            const range: IBufferRange = {
              start: { x: cellStart + 1, y: bufferLineNumber },
              end: { x: cellEnd, y: bufferLineNumber },
            };

            return {
              range,
              text: entry.text,
              decorations: { pointerCursor: true, underline: true },
              activate(): void {
                onFileLinkActivateRef.current(entry.filePath, entry.fileLine);
              },
            } satisfies ILink;
          }),
        ).then((results) => {
          const links = results.filter((result): result is ILink => result !== null);
          callback(links.length > 0 ? links : undefined);
        });
      },
    } satisfies ILinkProvider);

    term.attachCustomKeyEventHandler((event) => {
      if (event.key === "Enter" && event.shiftKey) {
        if (event.type === "keydown") {
          event.preventDefault();
          event.stopPropagation();
          window.electronAPI.ptyWrite(selectedId, "\x1b[13;2u");
        }
        return false;
      }
      return true;
    });

    term.onData((data) => {
      window.electronAPI.ptyWrite(selectedId, data);
    });

    term.onResize(({ cols, rows }) => {
      window.electronAPI.ptyResize(selectedId, cols, rows);
    });

    terminalRef.current = { term, fitAddon, container };

    let disposed = false;
    const disposePtyListener = window.electronAPI.onPtyData((sessionId, data) => {
      if (disposed || sessionId !== selectedId || !terminalRef.current) {
        return;
      }

      terminalRef.current.term.write(data);
    });

    requestAnimationFrame(() => {
      if (disposed || !terminalRef.current) {
        return;
      }

      fitTerminal();
      term.focus();
      void window.electronAPI
        .attachPty(selectedId)
        .then((scrollback) => {
          if (disposed || !terminalRef.current) {
            return;
          }

          term.reset();
          term.write(scrollback, () => {
            if (disposed) {
              return;
            }

            fitTerminal();
            void window.electronAPI.readyPty(selectedId);
          });
        })
        .catch(() => {
          if (disposed) {
            return;
          }

          fitTerminal();
        });
    });

    return () => {
      disposed = true;
      disposePtyListener();
      void window.electronAPI.detachPty(selectedId);
      terminalRef.current = null;
      term.dispose();
      container.remove();
    };
  }, [fitTerminal, selectedId]);

  useEffect(() => {
    if (!selectedId || !terminalRef.current) {
      return;
    }

    requestAnimationFrame(() => {
      fitTerminal();
    });
  }, [fitTerminal, selectedId, ...fitDependencies]);

  useEffect(() => {
    const handleResize = (): void => {
      fitTerminal();
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [fitTerminal]);

  return (
    <main className="terminal-container">
      {selectedId && (
        <div className="panel-header terminal-bar">
          <h2>Terminal</h2>
          <div className="terminal-bar-meta">
            {currentBranch && (
              <span className="terminal-bar-branch">
                <GitBranch size={11} strokeWidth={2} />
                {currentBranch}
              </span>
            )}
            {currentGitHub && (
              <GitHubBadge
                github={currentGitHub}
                onClick={() => {
                  if (currentGitHub.url) {
                    onOpenExternal(currentGitHub.url);
                  }
                }}
              />
            )}
          </div>
        </div>
      )}
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
  );
}

function stringIndexToCellIndex(
  line: ReturnType<Terminal["buffer"]["active"]["getLine"]>,
  strIndex: number,
): number {
  let cellIndex = 0;
  for (let i = 0; i < strIndex; i++) {
    const cell = line?.getCell(cellIndex);
    if (!cell) {
      break;
    }
    const width = cell.getWidth();
    cellIndex += width > 0 ? width : 1;
  }
  return cellIndex;
}
