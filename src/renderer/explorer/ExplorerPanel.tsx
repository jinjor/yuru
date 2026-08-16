import { Activity, useCallback, useState } from "react";
import type { GitPathState, GitReviewState } from "../../shared/ipc";
import { useCommandShortcut } from "../utils/useCommandShortcut";
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
import { Tab } from "../ui/Tab";

type ExplorerTab = "changes" | "files" | "search";

interface ExplorerPanelProps {
  gitPathStates: readonly GitPathState[];
  onPreviewSelectionChange: (selection: PreviewSelection | null) => void;
  previewSelection: PreviewSelection | null;
  reviewState: GitReviewState | null;
  width: number;
  worktreeId: string;
}

export function ExplorerPanel({
  gitPathStates,
  onPreviewSelectionChange,
  previewSelection,
  reviewState,
  width,
  worktreeId,
}: ExplorerPanelProps) {
  const [activeTab, setActiveTab] = useState<ExplorerTab>("changes");
  // 検索入力へフォーカスを促す合図。hidden の間 SearchPane の effect は動かないため、
  // ショートカットの受け口は常にマウントされているこちらに置く。
  const [searchFocusRequest, setSearchFocusRequest] = useState(0);
  const selectTab = useCallback((tab: ExplorerTab): void => {
    setActiveTab(tab);
    if (tab === "search") {
      setSearchFocusRequest((prev) => prev + 1);
    }
  }, []);
  const showSearch = useCallback(() => selectTab("search"), [selectTab]);
  useCommandShortcut({ key: "f", shift: true }, showSearch);
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
          <Tab selected={activeTab === "changes"} onSelect={() => selectTab("changes")}>
            Changes
            <span className="panel-tab-count" aria-label={`${changedFiles.length} changed files`}>
              {changedFiles.length}
            </span>
          </Tab>
          <Tab selected={activeTab === "files"} onSelect={() => selectTab("files")}>
            Files
          </Tab>
          <Tab selected={activeTab === "search"} onSelect={() => selectTab("search")}>
            Search
          </Tab>
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
