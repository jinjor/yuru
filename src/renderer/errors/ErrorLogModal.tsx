import { AlertTriangle, CircleAlert, X } from "lucide-react";
import type { AppErrorNotice } from "../../shared/ipc";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { IconButton } from "../ui/IconButton";
import { Modal } from "../ui/Modal";

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
              <Button onClick={() => void window.electronAPI.clearErrors()}>Clear all</Button>
            )}
            <IconButton label="Close" onClick={onClose}>
              <X size={14} strokeWidth={2} />
            </IconButton>
          </div>
        </div>
        {notices.length === 0 ? (
          <EmptyState>No errors</EmptyState>
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
                <IconButton
                  className="error-log-dismiss-btn"
                  label="Dismiss"
                  onClick={() => void window.electronAPI.dismissError(notice.id)}
                  size="sm"
                >
                  <X size={12} strokeWidth={2} />
                </IconButton>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
