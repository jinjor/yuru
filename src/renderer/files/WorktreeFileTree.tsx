import { type Ref, useImperativeHandle } from "react";
import { ChevronsDownUp, FolderGit2 } from "lucide-react";
import type { GitFileStatus, GitPathState } from "../../shared/ipc";
import { isTestFile } from "../../shared/test-file";
import { isExternalPath, type PreviewSelection } from "../preview/previewSelection";
import {
  buildIgnoredPathSet,
  buildTreeStatusMap,
  isIgnoredPath,
  treeStatusClass,
} from "../git/status";
import { Button } from "../ui/Button";
import { toAbsolutePath } from "../utils/filePath";
import { type FileTreeHandle, FileTreeList } from "./FileTreeList";
import { useDirectoryTree } from "./useDirectoryTree";

interface WorktreeFileTreeProps {
  changedFiles: readonly GitFileStatus[];
  gitPathStates: readonly GitPathState[];
  height: number;
  onPreviewSelectionChange: (selection: PreviewSelection | null) => void;
  previewSelection: PreviewSelection | null;
  ref?: Ref<FileTreeHandle>;
  worktreeId: string;
  worktreePath: string;
}

// worktree のファイルツリー。名前を git の状態で色分けし、変更のあるディレクトリだけを開ける。
// パスは worktree 基準の相対パスでやりとりする。
export function WorktreeFileTree({
  changedFiles,
  gitPathStates,
  height,
  onPreviewSelectionChange,
  previewSelection,
  ref,
  worktreeId,
  worktreePath,
}: WorktreeFileTreeProps) {
  const previewPath = previewSelection?.path ?? null;
  const tree = useDirectoryTree(
    worktreePath,
    previewPath && !isExternalPath(previewPath) ? previewPath : null,
  );
  const treeStatusByPath = buildTreeStatusMap(gitPathStates);
  const treeIgnoredPaths = buildIgnoredPathSet(gitPathStates);
  const { reveal } = tree;

  useImperativeHandle(ref, () => ({ revealDirectory: reveal }), [reveal]);

  return (
    <>
      {/* パネルが狭いときは、CSS がラベルを隠してアイコンだけにする。
          何のボタンかは title の tooltip に残る。 */}
      <div className="panel-subactions">
        <span className="panel-subactions-label panel-wide-only">Files</span>
        <div className="panel-header-actions">
          <Button
            onClick={() => {
              void tree.expandOnlyToShow(changedFiles.map((file) => file.path));
            }}
            disabled={changedFiles.length === 0}
            title="Expand only the directories that contain changed files"
          >
            <span className="panel-narrow-only">
              <FolderGit2 size={14} />
            </span>
            <span className="panel-wide-only">Changed dirs</span>
          </Button>
          <Button
            onClick={tree.collapseAll}
            disabled={tree.status !== "ready"}
            title="Collapse all directories"
          >
            <span className="panel-narrow-only">
              <ChevronsDownUp size={14} />
            </span>
            <span className="panel-wide-only">Collapse all</span>
          </Button>
        </div>
      </div>
      <FileTreeList
        height={height}
        tree={tree}
        rowOptions={(node) => {
          const statusClass = treeStatusClass(treeStatusByPath.get(node.path));
          const isIgnored = isIgnoredPath(node.path, treeIgnoredPaths);
          return {
            absolutePath: toAbsolutePath(worktreePath, node.path),
            isSelected: previewPath === node.path,
            nameClassName: `${statusClass} ${isIgnored ? "ignored" : ""} ${isTestFile(node.path) ? "test-file" : ""}`,
            onContextMenu: (event) => {
              event.preventDefault();
              void window.electronAPI.showFilePathContextMenu(worktreeId, node.path);
            },
            onFileClick: () => onPreviewSelectionChange({ path: node.path }),
            pastePath: node.path,
          };
        }}
      />
    </>
  );
}
