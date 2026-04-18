import type { GitFileStatus } from "../../../shared/ipc";
import type { PreviewSelection } from "../../types";
import { statusColor, statusLabel } from "../../utils/git";

interface ChangesPaneProps {
  changedFiles: readonly GitFileStatus[];
  onPreviewSelectionChange: (selection: PreviewSelection | null) => void;
  previewSelection: PreviewSelection | null;
}

export function ChangesPane({
  changedFiles,
  onPreviewSelectionChange,
  previewSelection,
}: ChangesPaneProps) {
  return (
    <div className="changes-list">
      {changedFiles.length === 0 && <div className="empty-changes">No changes</div>}
      {changedFiles.map((file) => (
        <div
          key={file.path}
          className={`change-item ${previewSelection?.kind === "diff" && previewSelection.path === file.path ? "selected" : ""}`}
          onClick={() => onPreviewSelectionChange({ kind: "diff", path: file.path })}
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
  );
}
