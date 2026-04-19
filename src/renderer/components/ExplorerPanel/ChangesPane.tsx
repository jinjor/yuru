import type { GitFileStatus } from "../../../shared/ipc";
import type { PreviewSelection } from "../../types";
import { statusColor, statusLabel } from "../../utils/git";
import { buildChangeSections } from "./changes";

interface ChangesPaneProps {
  onPreviewSelectionChange: (selection: PreviewSelection | null) => void;
  previewSelection: PreviewSelection | null;
  stagedFiles: readonly GitFileStatus[];
  unstagedFiles: readonly GitFileStatus[];
}

export function ChangesPane({
  onPreviewSelectionChange,
  previewSelection,
  stagedFiles,
  unstagedFiles,
}: ChangesPaneProps) {
  const sections = buildChangeSections({ stagedFiles, unstagedFiles });

  if (sections.length === 0) {
    return <div className="changes-list"><div className="empty-changes">No changes</div></div>;
  }

  return (
    <div className="changes-list">
      {sections.map((section) => (
        <ChangeSection
          key={section.key}
          files={section.files}
          label={section.label}
          onPreviewSelectionChange={onPreviewSelectionChange}
          previewSelection={previewSelection}
        />
      ))}
    </div>
  );
}

function ChangeSection({
  files,
  label,
  onPreviewSelectionChange,
  previewSelection,
}: {
  files: readonly GitFileStatus[];
  label: string;
  onPreviewSelectionChange: (selection: PreviewSelection | null) => void;
  previewSelection: PreviewSelection | null;
}) {
  return (
    <section className="change-section">
      <div className="change-section-header">
        <span>{label}</span>
        <span className="change-section-count">{files.length}</span>
      </div>
      {files.map((file) => (
        <div
          key={`${label}:${file.path}`}
          className={`change-item ${previewSelection?.path === file.path ? "selected" : ""}`}
          onClick={() => onPreviewSelectionChange({ path: file.path })}
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
    </section>
  );
}
