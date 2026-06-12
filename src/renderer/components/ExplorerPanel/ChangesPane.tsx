import type { GitFileStatus } from "../../../shared/ipc";
import type { PreviewSelection } from "../../types";
import { statusColor, statusLabel } from "../../utils/git";
import { LineStatLabel } from "../LineStatLabel";
import { buildChangeSections, type ChangeSection } from "./changes";

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
    return (
      <div className="changes-list">
        <div className="empty-changes">No changes</div>
      </div>
    );
  }

  return (
    <div className="changes-list">
      {sections.map((section) => (
        <ChangeSectionView
          key={section.key}
          section={section}
          onPreviewSelectionChange={onPreviewSelectionChange}
          previewSelection={previewSelection}
        />
      ))}
    </div>
  );
}

function ChangeSectionView({
  section,
  onPreviewSelectionChange,
  previewSelection,
}: {
  section: ChangeSection;
  onPreviewSelectionChange: (selection: PreviewSelection | null) => void;
  previewSelection: PreviewSelection | null;
}) {
  return (
    <section className="change-section">
      <div className="change-section-header">
        <span>{section.label}</span>
        <span className="change-section-count">{section.files.length}</span>
        <LineStatLabel lineStat={section.totalLineStat} />
      </div>
      {section.files.map((file) => {
        const isSelected =
          previewSelection?.path === file.path && previewSelection?.scope === section.key;
        return (
          <div
            key={`${section.label}:${file.path}`}
            className={`change-item ${isSelected ? "selected" : ""}`}
            onClick={() => onPreviewSelectionChange({ path: file.path, scope: section.key })}
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
            {file.lineStat && <LineStatLabel lineStat={file.lineStat} />}
          </div>
        );
      })}
    </section>
  );
}
