import { AlertTriangle, CircleAlert, X } from "lucide-react";
import { useEffect } from "react";
import type { AppErrorNotice } from "../../shared/ipc";
import { Modal } from "../shared/Modal";

interface ErrorLogModalProps {
  notices: AppErrorNotice[];
  onClose: () => void;
}

function formatNoticeTime(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}:${pad(date.getSeconds())}`;
}

export function ErrorLogModal({ notices, onClose }: ErrorLogModalProps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const errorCount = notices.filter((notice) => notice.severity === "error").length;
  const warningCount = notices.length - errorCount;

  return (
    <Modal onClose={onClose} topOffset={120}>
      <div className="error-log">
        <div className="error-log-header">
          <span className="error-log-title">Errors</span>
          {errorCount > 0 && <span className="error-count-badge">{errorCount}</span>}
          {warningCount > 0 && <span className="error-count-badge warning">{warningCount}</span>}
          <div className="error-log-header-actions">
            {notices.length > 0 && (
              <button
                type="button"
                className="error-log-clear-btn"
                onClick={() => void window.electronAPI.clearErrors()}
              >
                Clear all
              </button>
            )}
            <button
              type="button"
              className="error-log-close-btn"
              onClick={onClose}
              aria-label="Close"
            >
              <X size={14} strokeWidth={2} />
            </button>
          </div>
        </div>
        {notices.length === 0 ? (
          <div className="error-log-empty">No errors</div>
        ) : (
          <div className="error-log-list">
            {notices.map((notice) => (
              <div key={notice.id} className="error-log-row">
                <span className="error-log-time">{formatNoticeTime(notice.timestamp)}</span>
                <span className={`error-log-sev ${notice.severity}`}>
                  {notice.count > 1 ? (
                    <span className="error-log-count-pill">{notice.count}</span>
                  ) : notice.severity === "error" ? (
                    <CircleAlert size={12} strokeWidth={2} aria-hidden="true" />
                  ) : (
                    <AlertTriangle size={12} strokeWidth={2} aria-hidden="true" />
                  )}
                </span>
                <span className="error-log-body">
                  <span className="error-log-message">{notice.message}</span>
                  {notice.detail && <span className="error-log-detail">{notice.detail}</span>}
                </span>
                <button
                  type="button"
                  className="error-log-dismiss-btn"
                  onClick={() => void window.electronAPI.dismissError(notice.id)}
                  aria-label="Dismiss"
                >
                  <X size={12} strokeWidth={2} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
