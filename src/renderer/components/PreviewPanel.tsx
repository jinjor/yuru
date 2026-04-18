import type { ReactNode } from "react";
import { X } from "lucide-react";

interface PreviewPanelProps {
  children: ReactNode;
  onClose: () => void;
  path: string;
  title: string;
}

export function PreviewPanel({ children, onClose, path, title }: PreviewPanelProps) {
  return (
    <div className="preview-panel">
      <div className="panel-header preview-header">
        <h2>{title}</h2>
        <div className="preview-header-meta">
          <span className="preview-path">{path}</span>
          <button
            type="button"
            className="preview-close-btn"
            onClick={onClose}
            aria-label="Close code panel"
            title="Close code panel"
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>
      </div>
      <div className="preview-body">{children}</div>
    </div>
  );
}
