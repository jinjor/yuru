import { useEffect, useState } from "react";
import type { BranchContext, GitFileStatus, GitPathState } from "../../../shared/ipc";
import { useElementSize } from "../../hooks/useElementSize";
import type { PreviewSelection } from "../../types";
import { buildChangedFiles } from "../../utils/git";
import { resultDataOrNull } from "../../utils/result";
import { ChangesPane } from "./ChangesPane";
import { FilesPane } from "./FilesPane";

interface ExplorerPanelProps {
  onBranchContextChange: (context: BranchContext) => void;
  onPreviewSelectionChange: (selection: PreviewSelection | null) => void;
  previewSelection: PreviewSelection | null;
  refreshSessions: () => void;
  sessionId: string;
  width: number;
}

export function ExplorerPanel({
  onBranchContextChange,
  onPreviewSelectionChange,
  previewSelection,
  refreshSessions,
  sessionId,
  width,
}: ExplorerPanelProps) {
  const [panelRef, panelSize] = useElementSize<HTMLDivElement>();
  const [headerRef, headerSize] = useElementSize<HTMLDivElement>();
  const [gitPathStates, setGitPathStates] = useState<GitPathState[]>([]);
  const [changedFiles, setChangedFiles] = useState<GitFileStatus[]>([]);
  const [activeTab, setActiveTab] = useState<"changes" | "files">("changes");
  const contentHeight = Math.max(panelSize.height - headerSize.height, 0);

  useEffect(() => {
    let cancelled = false;
    onBranchContextChange({ branch: null, github: null });
    setGitPathStates([]);
    setChangedFiles([]);

    const fetchStatus = async (): Promise<void> => {
      const [pathStatesResult, branchContextResult] = await Promise.all([
        window.electronAPI.getGitPathStates(sessionId),
        window.electronAPI.getGitBranchContext(sessionId),
      ]);
      if (cancelled) {
        return;
      }

      const pathStates = resultDataOrNull(pathStatesResult) ?? [];
      setGitPathStates(pathStates);
      setChangedFiles((prev) => {
        const nextFiles = buildChangedFiles(pathStates);
        if (JSON.stringify(prev) === JSON.stringify(nextFiles)) {
          return prev;
        }
        return nextFiles;
      });

      if (
        previewSelection?.kind === "diff" &&
        !pathStates.some(
          (entry) => !entry.ignored && entry.status && entry.path === previewSelection.path,
        )
      ) {
        onPreviewSelectionChange(null);
      }

      const branchContext = resultDataOrNull(branchContextResult);
      onBranchContextChange(branchContext ?? { branch: null, github: null });
      refreshSessions();
    };

    void fetchStatus();
    const interval = setInterval(() => {
      void fetchStatus();
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [
    onBranchContextChange,
    onPreviewSelectionChange,
    previewSelection,
    refreshSessions,
    sessionId,
  ]);

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
          changedFiles={changedFiles}
          onPreviewSelectionChange={onPreviewSelectionChange}
          previewSelection={previewSelection}
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
