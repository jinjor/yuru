import { AlertTriangle } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "../ui/Button";

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  error: Error | null;
}

// 描画中の例外で React がツリー全体をアンマウントすると画面が真っ白になるため、
// 代わりにエラー内容と Reload 導線を出す。エラーは error center にも報告するので、
// リロード後もエラーログから確認できる。
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    const detail = [error.stack ?? error.message, errorInfo.componentStack]
      .filter(Boolean)
      .join("\n");
    window.electronAPI.reportRendererError("The screen failed to render.", detail);
  }

  render(): ReactNode {
    if (!this.state.error) {
      return this.props.children;
    }
    return (
      <div className="crash-screen">
        <div className="crash-screen-inner">
          <AlertTriangle size={26} strokeWidth={2} aria-hidden="true" className="crash-icon" />
          <div className="crash-title">Something went wrong</div>
          <p className="crash-text">
            The screen failed to render. This error is saved in the error log.
          </p>
          <pre className="crash-error">{this.state.error.stack ?? this.state.error.message}</pre>
          <Button variant="primary" onClick={() => location.reload()}>
            Reload
          </Button>
        </div>
      </div>
    );
  }
}
