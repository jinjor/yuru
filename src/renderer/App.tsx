import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

declare global {
  interface Window {
    electronAPI: {
      ptyWrite: (data: string) => void;
      ptyResize: (cols: number, rows: number) => void;
      onPtyData: (callback: (data: string) => void) => void;
    };
  }
}

export function App(): JSX.Element {
  const terminalRef = useRef<HTMLDivElement>(null);

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
    term.focus();
    window.electronAPI.ptyResize(term.cols, term.rows);

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

  return (
    <div className="app">
      <aside className="sidebar left">
        <section className="panel">
          <h3>Sessions</h3>
          <p className="placeholder">--resume sessions</p>
        </section>
        <section className="panel">
          <h3>Worktrees</h3>
          <p className="placeholder">git worktrees</p>
        </section>
      </aside>
      <main className="terminal-container">
        <div ref={terminalRef} className="terminal" />
      </main>
      <aside className="sidebar right">
        <section className="panel">
          <h3>Status</h3>
          <p className="placeholder">git status / diff</p>
        </section>
        <section className="panel">
          <h3>Usage</h3>
          <p className="placeholder">Claude Code usage</p>
        </section>
      </aside>
    </div>
  );
}
