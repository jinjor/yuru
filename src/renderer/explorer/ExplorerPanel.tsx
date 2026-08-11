import { Activity } from "react";
import type { GitPathState, GitReviewState } from "../../shared/ipc";
import { useElementSize } from "../utils/useElementSize";
import type { PreviewSelection } from "../previewSelection";
import {
  buildChangedFiles,
  buildConflictedFiles,
  buildStagedFiles,
  buildUnstagedFiles,
} from "../changes/gitStatus";
import { ChangesPane } from "../changes/ChangesPane";
import { FilesPane } from "../files/FilesPane";
import { SearchPane } from "../search/SearchPane";

export type ExplorerTab = "changes" | "files" | "search";

interface ExplorerPanelProps {
  activeTab: ExplorerTab;
  gitPathStates: readonly GitPathState[];
  onPreviewSelectionChange: (selection: PreviewSelection | null) => void;
  onTabChange: (tab: ExplorerTab) => void;
  previewSelection: PreviewSelection | null;
  reviewState: GitReviewState | null;
  searchFocusRequest: number;
  width: number;
  worktreeId: string;
}

export function ExplorerPanel({
  activeTab,
  gitPathStates,
  onPreviewSelectionChange,
  onTabChange,
  previewSelection,
  reviewState,
  searchFocusRequest,
  width,
  worktreeId,
}: ExplorerPanelProps) {
  const [panelRef, panelSize] = useElementSize<HTMLDivElement>();
  const [headerRef, headerSize] = useElementSize<HTMLDivElement>();
  const contentHeight = Math.max(panelSize.height - headerSize.height, 0);
  const changedFiles = buildChangedFiles(gitPathStates);
  const conflictedFiles = buildConflictedFiles(gitPathStates);
  const stagedFiles = buildStagedFiles(gitPathStates);
  const unstagedFiles = buildUnstagedFiles(gitPathStates);

  return (
    <aside ref={panelRef} className="changes-panel" style={{ width, minWidth: width }}>
      <div ref={headerRef} className="panel-header panel-header-stack">
        <div className="panel-tabs">
          <button
            className={`panel-tab ${activeTab === "changes" ? "active" : ""}`}
            onClick={() => onTabChange("changes")}
          >
            Changes
            <span className="panel-tab-count" aria-label={`${changedFiles.length} changed files`}>
              {changedFiles.length}
            </span>
          </button>
          <button
            className={`panel-tab ${activeTab === "files" ? "active" : ""}`}
            onClick={() => onTabChange("files")}
          >
            Files
          </button>
          <button
            className={`panel-tab ${activeTab === "search" ? "active" : ""}`}
            onClick={() => onTabChange("search")}
          >
            Search
          </button>
        </div>
      </div>
      <Activity mode={activeTab === "changes" ? "visible" : "hidden"}>
        <ChangesPane
          conflictedFiles={conflictedFiles}
          onPreviewSelectionChange={onPreviewSelectionChange}
          previewSelection={previewSelection}
          reviewState={reviewState}
          stagedFiles={stagedFiles}
          unstagedFiles={unstagedFiles}
        />
      </Activity>
      <Activity mode={activeTab === "search" ? "visible" : "hidden"}>
        <SearchPane
          focusRequest={searchFocusRequest}
          onPreviewSelectionChange={onPreviewSelectionChange}
          previewSelection={previewSelection}
          worktreeId={worktreeId}
        />
      </Activity>
      <Activity mode={activeTab === "files" ? "visible" : "hidden"}>
        <FilesPane
          changedFiles={changedFiles}
          gitPathStates={gitPathStates}
          height={contentHeight || 400}
          onPreviewSelectionChange={onPreviewSelectionChange}
          previewSelection={previewSelection}
          worktreeId={worktreeId}
        />
      </Activity>
    </aside>
  );
}
