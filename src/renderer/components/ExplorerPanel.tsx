import type { RefObject } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Tree, type NodeRendererProps, type TreeApi } from "react-arborist";
import type { FileTreeNode, GitFileStatus } from "../../shared/ipc";
import { useElementSize } from "../hooks/useElementSize";
import { statusColor, statusLabel, treeStatusClass } from "../utils/git";

interface ExplorerPanelProps {
  activeTab: "changes" | "files";
  files: GitFileStatus[];
  onChangeTab: (tab: "changes" | "files") => void;
  onCollapseAllDirectories: () => void;
  onRevealChangedDirectories: () => void;
  onSelectDiffFile: (filePath: string) => void;
  onSelectTreeFile: (filePath: string) => void;
  onToggleDirectory: (path: string) => void;
  selectedDiffFile: string | null;
  selectedTreeFile: string | null;
  treeRef: RefObject<TreeApi<FileTreeNode> | undefined>;
  treeData: FileTreeNode[];
  treeLoading: boolean;
  width: number;
}

export function ExplorerPanel({
  activeTab,
  files,
  onChangeTab,
  onCollapseAllDirectories,
  onRevealChangedDirectories,
  onSelectDiffFile,
  onSelectTreeFile,
  onToggleDirectory,
  selectedDiffFile,
  selectedTreeFile,
  treeRef,
  treeData,
  treeLoading,
  width,
}: ExplorerPanelProps) {
  const [panelRef, panelSize] = useElementSize<HTMLDivElement>();
  const [headerRef, headerSize] = useElementSize<HTMLDivElement>();
  const treeHeight = Math.max(panelSize.height - headerSize.height, 0);

  return (
    <aside ref={panelRef} className="changes-panel" style={{ width, minWidth: width }}>
      <div ref={headerRef} className="panel-header panel-header-stack">
        <div className="panel-tabs">
          <button
            className={`panel-tab ${activeTab === "changes" ? "active" : ""}`}
            onClick={() => onChangeTab("changes")}
          >
            Changes
            <span className="panel-tab-count" aria-label={`${files.length} changed files`}>
              {files.length}
            </span>
          </button>
          <button
            className={`panel-tab ${activeTab === "files" ? "active" : ""}`}
            onClick={() => onChangeTab("files")}
          >
            Files
          </button>
        </div>
        {activeTab === "files" && (
          <div className="panel-subactions">
            <span className="panel-subactions-label">Files</span>
            <div className="panel-header-actions">
              <button
                className="panel-header-action"
                onClick={onRevealChangedDirectories}
                disabled={files.length === 0}
                title="Expand only the directories that contain changed files"
              >
                Changed dirs
              </button>
              <button
                className="panel-header-action"
                onClick={onCollapseAllDirectories}
                disabled={treeData.length === 0}
                title="Collapse all directories"
              >
                Collapse all
              </button>
            </div>
          </div>
        )}
      </div>
      {activeTab === "changes" ? (
        <div className="changes-list">
          {files.length === 0 && <div className="empty-changes">No changes</div>}
          {files.map((file) => (
            <div
              key={file.path}
              className={`change-item ${selectedDiffFile === file.path ? "selected" : ""}`}
              onClick={() => onSelectDiffFile(file.path)}
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
      ) : (
        <div className="file-tree">
          {treeLoading && treeData.length === 0 ? (
            <div className="empty-changes">Loading files...</div>
          ) : treeData.length === 0 ? (
            <div className="empty-changes">No files</div>
          ) : (
            <Tree<FileTreeNode>
              ref={treeRef}
              data={treeData}
              width="100%"
              height={treeHeight || 400}
              rowHeight={28}
              indent={12}
              openByDefault={false}
              selection={selectedTreeFile ?? undefined}
              disableDrag
              disableEdit
              onActivate={(node) => {
                if (node.data.kind === "file") {
                  onSelectTreeFile(node.data.path);
                }
              }}
              onToggle={onToggleDirectory}
            >
              {FileTreeRow}
            </Tree>
          )}
        </div>
      )}
    </aside>
  );
}

function FileTreeRow({ node, style, dragHandle }: NodeRendererProps<FileTreeNode>) {
  const isDirectory = node.data.kind === "directory";
  const statusClass = treeStatusClass(node.data.gitStatus);

  return (
    <div
      ref={dragHandle}
      style={style}
      className={`file-tree-row ${node.isSelected ? "selected" : ""}`}
      onClick={() => {
        if (isDirectory) {
          node.toggle();
        } else {
          node.select();
          node.activate();
        }
      }}
    >
      <span className={`file-tree-caret ${isDirectory ? "directory" : "file"}`}>
        {isDirectory ? (
          node.isOpen ? (
            <ChevronDown size={15} strokeWidth={2.4} />
          ) : (
            <ChevronRight size={15} strokeWidth={2.4} />
          )
        ) : null}
      </span>
      <span
        className={`file-tree-name ${node.data.kind} ${statusClass} ${node.data.isIgnored ? "ignored" : ""}`}
      >
        {node.data.name}
      </span>
    </div>
  );
}
