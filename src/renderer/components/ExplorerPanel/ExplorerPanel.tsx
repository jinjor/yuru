import { useState } from "react";
import type { GitPathState } from "../../../shared/ipc";
import { useElementSize } from "../../hooks/useElementSize";
import type { PreviewSelection } from "../../types";
import { buildChangedFiles, buildStagedFiles, buildUnstagedFiles } from "../../utils/git";
import { ChangesPane } from "./ChangesPane";
import { FilesPane } from "./FilesPane";

interface ExplorerPanelProps {
  gitPathStates: readonly GitPathState[];
  onPreviewSelectionChange: (selection: PreviewSelection | null) => void;
  previewSelection: PreviewSelection | null;
  sessionId: string;
  width: number;
}

export function ExplorerPanel({
  gitPathStates,
  onPreviewSelectionChange,
  previewSelection,
  sessionId,
  width,
}: ExplorerPanelProps) {
  const [panelRef, panelSize] = useElementSize<HTMLDivElement>();
  const [headerRef, headerSize] = useElementSize<HTMLDivElement>();
  const [activeTab, setActiveTab] = useState<"changes" | "files">("changes");
  const contentHeight = Math.max(panelSize.height - headerSize.height, 0);
  const changedFiles = buildChangedFiles(gitPathStates);
  const stagedFiles = buildStagedFiles(gitPathStates);
  const unstagedFiles = buildUnstagedFiles(gitPathStates);

  return (
    <aside ref={panelRef} className="changes-panel" style={{ width, minWidth: width }}>
      <div ref={headerRef} className="panel-header panel-header-stack">
        <div className="panel-tabs">
          <button
            className={`panel-tab ${activeTab === "changes" ? "active" : ""}`}
            onClick={() => setActiveTab("changes")}
          >
            Changes
            <span className="panel-tab-count" aria-label={`${changedFiles.length} changed files`}>
              {changedFiles.length}
            </span>
          </button>
          <button
            className={`panel-tab ${activeTab === "files" ? "active" : ""}`}
            onClick={() => setActiveTab("files")}
          >
            Files
          </button>
        </div>
      </div>
      {activeTab === "changes" ? (
        <ChangesPane
          onPreviewSelectionChange={onPreviewSelectionChange}
          previewSelection={previewSelection}
          stagedFiles={stagedFiles}
          unstagedFiles={unstagedFiles}
        />
      ) : (
        <FilesPane
          changedFiles={changedFiles}
          gitPathStates={gitPathStates}
          height={contentHeight || 400}
          onPreviewSelectionChange={onPreviewSelectionChange}
          previewSelection={previewSelection}
          sessionId={sessionId}
        />
      )}
    </aside>
  );
}
