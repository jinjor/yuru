import { FitAddon } from "@xterm/addon-fit";
import { Terminal, type ILink, type ILinkProvider } from "@xterm/xterm";
import { type DragEvent, useCallback, useEffect, useRef, useState } from "react";
import { hasWorktreeFileDrag, readWorktreeFileDrag } from "../utils/fileDrag";
import { findTerminalLinksInBufferLine } from "./terminalBufferLinks";

interface TerminalPanelProps {
  changesPanelWidth: number;
  isPreviewOpen: boolean;
  onFileLinkActivate: (filePath: string, line?: number) => void;
  previewRatio: number;
  terminalRuntimeId: string;
}

interface TerminalInstance {
  term: Terminal;
  fitAddon: FitAddon;
  container: HTMLDivElement;
}

interface WorktreeFileDropTarget {
  isDragOver: boolean;
  onDragEnter: (event: DragEvent<HTMLDivElement>) => void;
  onDragLeave: (event: DragEvent<HTMLDivElement>) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
}

export function TerminalPanel({
  changesPanelWidth,
  isPreviewOpen,
  onFileLinkActivate,
  previewRatio,
  terminalRuntimeId,
}: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<TerminalInstance | null>(null);
  const fileDropTarget = useWorktreeFileDrop((relativePath) => {
    const term = terminalRef.current?.term;
    if (!term) {
      return;
    }
    term.focus();
    term.paste(relativePath);
  });
  const onFileLinkActivateRef = useRef(onFileLinkActivate);
  onFileLinkActivateRef.current = onFileLinkActivate;

  const fitTerminal = useCallback((): void => {
    if (!terminalRef.current) {
      return;
    }

    terminalRef.current.fitAddon.fit();
    window.electronAPI.ptyResize(
      terminalRuntimeId,
      terminalRef.current.term.cols,
      terminalRef.current.term.rows,
    );
  }, [terminalRuntimeId]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const container = document.createElement("div");
    container.className = "terminal";
    container.style.display = "block";

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      fontFamily: "Menlo, Monaco, monospace",
      scrollback: 4000,
      // OSC 8 ハイパーリンクも既定ブラウザで開く。未設定だと xterm.js 内蔵の
      // confirm ダイアログ + window.open が走り、Electron の子ウインドウが開いてしまう。
      linkHandler: {
        activate(_event, uri): void {
          void window.electronAPI.openExternal(uri).catch((error) => {
            console.error("Failed to open terminal URL.", error);
          });
        },
      },
      theme: {
        background: "#0f141c",
        foreground: "#d8e1ef",
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    containerRef.current.appendChild(container);
    term.open(container);

    term.registerLinkProvider({
      provideLinks(bufferLineNumber: number, callback: (links: ILink[] | undefined) => void): void {
        const matches = findTerminalLinksInBufferLine(
          term.buffer.active,
          term.cols,
          bufferLineNumber,
        );

        if (matches.length === 0) {
          callback(undefined);
          return;
        }

        const links = matches.map((entry): ILink => {
          return {
            range: entry.range,
            text: entry.text,
            decorations: { pointerCursor: true, underline: true },
            activate(): void {
              if (entry.kind === "url") {
                void window.electronAPI.openExternal(entry.url).catch((error) => {
                  console.error("Failed to open terminal URL.", error);
                });
                return;
              }

              onFileLinkActivateRef.current(entry.filePath, entry.fileLine);
            },
          };
        });
        callback(links);
      },
    } satisfies ILinkProvider);

    term.attachCustomKeyEventHandler((event) => {
      const sequence = terminalKeySequence(event);
      if (sequence) {
        if (event.type === "keydown") {
          event.preventDefault();
          event.stopPropagation();
          window.electronAPI.ptyWrite(terminalRuntimeId, sequence);
        }
        return false;
      }
      return true;
    });

    term.onData((data) => {
      window.electronAPI.ptyWrite(terminalRuntimeId, data);
    });

    term.onResize(({ cols, rows }) => {
      window.electronAPI.ptyResize(terminalRuntimeId, cols, rows);
    });

    terminalRef.current = { term, fitAddon, container };

    let disposed = false;
    const disposePtyListener = window.electronAPI.onPtyData((dataTerminalRuntimeId, data) => {
      if (disposed || dataTerminalRuntimeId !== terminalRuntimeId || !terminalRef.current) {
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
        .attachPty(terminalRuntimeId)
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
            void window.electronAPI.readyPty(terminalRuntimeId);
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
      void window.electronAPI.detachPty(terminalRuntimeId);
      terminalRef.current = null;
      term.dispose();
      container.remove();
    };
  }, [fitTerminal, terminalRuntimeId]);

  useEffect(() => {
    if (!terminalRef.current) {
      return;
    }

    requestAnimationFrame(() => {
      fitTerminal();
    });
  }, [changesPanelWidth, fitTerminal, isPreviewOpen, previewRatio]);

  useEffect(() => {
    const handleResize = (): void => {
      fitTerminal();
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [fitTerminal]);

  return (
    <div
      ref={containerRef}
      className={`terminal-host ${fileDropTarget.isDragOver ? "file-drop-target" : ""}`}
      onDragEnter={fileDropTarget.onDragEnter}
      onDragLeave={fileDropTarget.onDragLeave}
      onDragOver={fileDropTarget.onDragOver}
      onDrop={fileDropTarget.onDrop}
    />
  );
}

function useWorktreeFileDrop(onPathDrop: (relativePath: string) => void): WorktreeFileDropTarget {
  const dragDepthRef = useRef(0);
  const [isDragOver, setIsDragOver] = useState(false);

  const onDragEnter = (event: DragEvent<HTMLDivElement>): void => {
    if (!hasWorktreeFileDrag(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDragOver(true);
  };

  const onDragOver = (event: DragEvent<HTMLDivElement>): void => {
    if (!hasWorktreeFileDrag(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const onDragLeave = (event: DragEvent<HTMLDivElement>): void => {
    if (!hasWorktreeFileDrag(event.dataTransfer)) {
      return;
    }
    dragDepthRef.current = Math.max(dragDepthRef.current - 1, 0);
    if (dragDepthRef.current === 0) {
      setIsDragOver(false);
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    if (!hasWorktreeFileDrag(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = 0;
    setIsDragOver(false);
    onPathDrop(readWorktreeFileDrag(event.dataTransfer));
  };

  return { isDragOver, onDragEnter, onDragLeave, onDragOver, onDrop };
}

function terminalKeySequence(event: KeyboardEvent): string | null {
  if (event.key === "Enter" && event.shiftKey) {
    return "\x1b[13;2u";
  }

  if (!event.metaKey || event.shiftKey || event.ctrlKey || event.altKey) {
    return null;
  }

  if (event.key === "ArrowLeft") {
    return "\x1bOH";
  }

  if (event.key === "ArrowRight") {
    return "\x1bOF";
  }

  return null;
}
