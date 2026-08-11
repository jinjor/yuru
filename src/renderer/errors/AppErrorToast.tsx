import { CircleAlert, X } from "lucide-react";
import { useEffect } from "react";
import type { AppError } from "../../shared/ipc";

const AUTO_DISMISS_MS = 5000;

interface AppErrorToastProps {
  error: AppError;
  onDismiss: () => void;
}

export function AppErrorToast({ error, onDismiss }: AppErrorToastProps) {
  useEffect(() => {
    const timeoutId = window.setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => window.clearTimeout(timeoutId);
  }, [error, onDismiss]);

  return (
    <div className="app-error-toast" role="alert">
      <CircleAlert className="app-error-toast-icon" size={16} strokeWidth={2} aria-hidden="true" />
      <span className="app-error-toast-body">
        <span className="app-error-toast-message">{error.message}</span>
        {error.detail && <span className="app-error-toast-detail">{error.detail}</span>}
      </span>
      <button
        type="button"
        className="app-error-toast-dismiss"
        onClick={onDismiss}
        aria-label="Dismiss notification"
      >
        <X size={14} strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  );
}
