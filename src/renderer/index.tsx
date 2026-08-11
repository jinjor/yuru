import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AppErrorBoundary } from "./errors/AppErrorBoundary";
import "./style.css";

// 描画エラー (ErrorBoundary 行き) 以外の uncaught error / unhandled rejection は
// 画面を壊さないが、後から調べられるように error center に記録だけ残す。
window.addEventListener("error", (event) => {
  window.electronAPI.reportRendererError(event.message, event.error?.stack);
});
window.addEventListener("unhandledrejection", (event) => {
  const reason: unknown = event.reason;
  if (reason instanceof Error) {
    window.electronAPI.reportRendererError(`Unhandled rejection: ${reason.message}`, reason.stack);
    return;
  }
  window.electronAPI.reportRendererError(`Unhandled rejection: ${String(reason)}`);
});

const root = createRoot(document.getElementById("root")!);
root.render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>,
);
