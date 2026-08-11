import { BookOpen, Check, Eye, Pencil, X } from "lucide-react";
import type { GitLineStat } from "../../shared/ipc";
import type { FileViewMode } from "./fileViewMode";
import { LineStatLabel } from "../changes/LineStatLabel";

interface PreviewHeaderProps {
  baseBranch?: string;
  // repo-relative なファイルパス (前方がディレクトリ、末尾がファイル名)。
  path: string;
  mode: FileViewMode;
  onModeChange: (mode: FileViewMode) => void;
  // Markdown / HTML のときだけ閲覧の左にプレビューモードを出す。
  showPreview: boolean;
  canEdit: boolean;
  // canEdit が false のときに編集アイコンへ出す理由 (tooltip)。
  editDisabledReason?: string;
  lineStat?: GitLineStat;
  reviewed?: boolean;
  reviewPending: boolean;
  onReviewedChange: (reviewed: boolean) => void;
  onClose: () => void;
}

function splitPath(path: string): { name: string; dir: string } {
  const lastSlash = path.lastIndexOf("/");
  if (lastSlash < 0) {
    return { name: path, dir: "" };
  }
  return { name: path.slice(lastSlash + 1), dir: path.slice(0, lastSlash) };
}

export function PreviewHeader({
  baseBranch,
  path,
  mode,
  onModeChange,
  showPreview,
  canEdit,
  editDisabledReason,
  lineStat,
  reviewed,
  reviewPending,
  onReviewedChange,
  onClose,
}: PreviewHeaderProps) {
  const { name, dir } = splitPath(path);

  return (
    <div className="panel-header preview-header">
      <div className="preview-filemeta">
        <span className="preview-filename">{name}</span>
        {dir && (
          <span className="preview-dir" title={path}>
            {dir}
          </span>
        )}
      </div>
      {baseBranch && (
        <span className="preview-scope-label">
          from <span>{baseBranch}</span>
        </span>
      )}
      <div className="preview-mode-segment" role="group" aria-label="View mode">
        {showPreview && (
          <button
            type="button"
            className={`preview-mode-btn ${mode === "preview" ? "active" : ""}`}
            onClick={() => onModeChange("preview")}
            aria-pressed={mode === "preview"}
            title="Preview"
          >
            <BookOpen size={15} strokeWidth={2} />
          </button>
        )}
        <button
          type="button"
          className={`preview-mode-btn ${mode === "view" ? "active" : ""}`}
          onClick={() => onModeChange("view")}
          aria-pressed={mode === "view"}
          title="View"
        >
          <Eye size={15} strokeWidth={2} />
        </button>
        <button
          type="button"
          className={`preview-mode-btn ${mode === "edit" ? "active" : ""}`}
          onClick={() => onModeChange("edit")}
          disabled={!canEdit}
          aria-pressed={mode === "edit"}
          title={canEdit ? "Edit" : (editDisabledReason ?? "Cannot edit this view")}
        >
          <Pencil size={15} strokeWidth={2} />
        </button>
      </div>
      {reviewed !== undefined && (
        <button
          type="button"
          className={`reviewed-toggle ${reviewed ? "on" : ""}`}
          onClick={() => onReviewedChange(!reviewed)}
          disabled={reviewPending}
          aria-pressed={reviewed}
        >
          <span className="reviewed-toggle-dot" aria-hidden="true">
            {reviewed && <Check size={8} strokeWidth={4} />}
          </span>
          Reviewed
        </button>
      )}
      {lineStat && <LineStatLabel lineStat={lineStat} />}
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
  );
}
