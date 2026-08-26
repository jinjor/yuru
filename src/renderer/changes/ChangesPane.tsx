import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import type { GitFileStatus, GitReviewState } from "../../shared/ipc";
import { isTestFile } from "../../shared/test-file";
import type { PreviewSelection } from "../previewSelection";
import { statusColor, statusLabel } from "./gitStatus";
import { LineStatLabel } from "./LineStatLabel";
import { buildChangeSections, type ChangeSection } from "./changes";
import { EmptyState } from "../ui/EmptyState";
import { beginWorktreeFileDrag, endWorktreeFileDrag } from "../utils/fileDrag";

interface ChangesPaneProps {
  conflictedFiles: readonly GitFileStatus[];
  onPreviewSelectionChange: (selection: PreviewSelection | null) => void;
  previewSelection: PreviewSelection | null;
  reviewState: GitReviewState | null;
  stagedFiles: readonly GitFileStatus[];
  unstagedFiles: readonly GitFileStatus[];
}

export function ChangesPane({
  conflictedFiles,
  onPreviewSelectionChange,
  previewSelection,
  reviewState,
  stagedFiles,
  unstagedFiles,
}: ChangesPaneProps) {
  const [isCommittedExpanded, setIsCommittedExpanded] = useState(false);
  const workingChecks = new Map(
    reviewState?.kind === "ready"
      ? reviewState.workingChecks.map((check) => [check.path, check] as const)
      : [],
  );
  const reviewedStagedFiles = stagedFiles.map((file) => ({
    ...file,
    reviewed: workingChecks.get(file.path)?.stagedReviewed ?? false,
  }));
  const reviewedUnstagedFiles = unstagedFiles.map((file) => ({
    ...file,
    reviewed: workingChecks.get(file.path)?.unstagedReviewed ?? false,
  }));
  const sections = buildChangeSections({
    conflictedFiles,
    committedFiles: reviewState?.kind === "ready" ? reviewState.committedFiles : [],
    stagedFiles: reviewedStagedFiles,
    unstagedFiles: reviewedUnstagedFiles,
  });
  const conflictedSection = sections.find((section) => section.key === "conflicted");
  const regularSections = sections.filter((section) => section.key !== "conflicted");
  const showsNoBase = reviewState?.kind === "no-base";

  if (sections.length === 0 && !showsNoBase) {
    return (
      <div className="changes-list">
        <EmptyState>No changes</EmptyState>
      </div>
    );
  }

  return (
    <div className="changes-list">
      {conflictedSection && (
        <ChangeSectionView
          section={conflictedSection}
          onPreviewSelectionChange={onPreviewSelectionChange}
          previewSelection={previewSelection}
        />
      )}
      {showsNoBase && (
        <section className="change-section">
          <div className="change-section-header">
            <span>Committed</span>
          </div>
          <div className="change-section-no-base">Base branch is unknown.</div>
        </section>
      )}
      {regularSections.map((section) => (
        <ChangeSectionView
          key={section.key}
          section={section}
          baseBranch={reviewState?.kind === "ready" ? reviewState.baseBranch : undefined}
          expanded={section.key !== "base" || isCommittedExpanded}
          onExpandedChange={section.key === "base" ? setIsCommittedExpanded : undefined}
          onPreviewSelectionChange={onPreviewSelectionChange}
          previewSelection={previewSelection}
        />
      ))}
    </div>
  );
}

function ChangeSectionView({
  section,
  baseBranch,
  expanded = true,
  onExpandedChange,
  onPreviewSelectionChange,
  previewSelection,
}: {
  section: ChangeSection;
  baseBranch?: string;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  onPreviewSelectionChange: (selection: PreviewSelection | null) => void;
  previewSelection: PreviewSelection | null;
}) {
  // conflicted file は staged/unstaged の diff が成立しないため、
  // scope なし (HEAD ↔ 作業ツリー) の diff を開く
  const scope = section.key === "conflicted" ? undefined : section.key;
  const headerContents = (
    <>
      {onExpandedChange && (
        <span className="change-section-chevron" aria-hidden="true">
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
      )}
      <span>{section.label}</span>
      {section.key === "base" && baseBranch && (
        <span className="change-section-base">{baseBranch}</span>
      )}
      <LineStatLabel lineStat={section.totalLineStat} />
    </>
  );

  return (
    <section className="change-section">
      {onExpandedChange ? (
        <button
          type="button"
          className="change-section-header change-section-toggle"
          onClick={() => onExpandedChange(!expanded)}
          aria-expanded={expanded}
        >
          {headerContents}
        </button>
      ) : (
        <div className="change-section-header">{headerContents}</div>
      )}
      {expanded &&
        section.files.map((file) => {
          const isSelected =
            previewSelection?.path === file.path && previewSelection?.scope === scope;
          const lastSlash = file.path.lastIndexOf("/");
          const name = lastSlash < 0 ? file.path : file.path.slice(lastSlash + 1);
          const dir = lastSlash < 0 ? "" : file.path.slice(0, lastSlash);
          return (
            <div
              key={`${section.label}:${file.path}`}
              className={`change-item ${isSelected ? "selected" : ""} ${file.reviewed ? "reviewed" : ""} ${isTestFile(file.path) ? "test-file" : ""}`}
              draggable
              onDragEnd={(event) => endWorktreeFileDrag(event.currentTarget)}
              onDragStart={(event) =>
                beginWorktreeFileDrag(event.dataTransfer, event.currentTarget, file.path)
              }
              onClick={() => onPreviewSelectionChange({ path: file.path, scope })}
            >
              <span className="change-status" style={{ color: statusColor(file.status) }}>
                {statusLabel(file.status)}
              </span>
              <span className="change-path" title={file.path}>
                <span className="change-filename">{name}</span>
                {dir && <span className="change-dir">{dir}</span>}
              </span>
              {file.lineStat && <LineStatLabel lineStat={file.lineStat} />}
            </div>
          );
        })}
    </section>
  );
}
