import { type Ref, useEffect, useImperativeHandle } from "react";
import { ChevronsDownUp, Folder, X } from "lucide-react";
import { isExternalPath, type PreviewSelection } from "../preview/previewSelection";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { splitDirectoryPath, toAbsolutePath, toRootRelativePath } from "../utils/filePath";
import { type FileTreeHandle, FileTreeList } from "./FileTreeList";
import { useDirectoryTree } from "./useDirectoryTree";

interface ExternalDirectoryTreeProps {
  // 表示するディレクトリの絶対パス。
  directoryPath: string;
  height: number;
  // ✕ が押されたとき、またはディレクトリが消えたときに呼ぶ。
  onClose: () => void;
  onPreviewSelectionChange: (selection: PreviewSelection | null) => void;
  previewSelection: PreviewSelection | null;
  ref?: Ref<FileTreeHandle>;
  // 右クリックのメニューで、どの worktree の右ペインのパスかを伝える。
  worktreeId: string;
}

// worktree の外のディレクトリのツリー。git の状態は持たず、パスは絶対パスでやりとりする。
export function ExternalDirectoryTree({
  directoryPath,
  height,
  onClose,
  onPreviewSelectionChange,
  previewSelection,
  ref,
  worktreeId,
}: ExternalDirectoryTreeProps) {
  const previewPath = previewSelection?.path ?? null;
  const tree = useDirectoryTree(
    directoryPath,
    previewPath && isExternalPath(previewPath)
      ? toRootRelativePath(directoryPath, previewPath)
      : null,
  );
  const { name, parent } = splitDirectoryPath(directoryPath);
  const { reveal, status } = tree;

  useImperativeHandle(ref, () => ({ revealDirectory: reveal }), [reveal]);

  // 表示中のディレクトリが消えたら、✕ と同じく閉じる。
  useEffect(() => {
    if (status === "missing") {
      onClose();
    }
  }, [onClose, status]);

  return (
    <>
      <div className="external-tree-header">
        <Folder className="external-tree-icon" size={14} />
        <span className="external-tree-title" title={directoryPath}>
          <span className="external-tree-name">{name}</span>
          <span className="external-tree-parent panel-wide-only">{parent}</span>
        </span>
        <Button
          onClick={tree.collapseAll}
          disabled={status !== "ready"}
          title="Collapse all directories"
        >
          <span className="panel-narrow-only">
            <ChevronsDownUp size={14} />
          </span>
          <span className="panel-wide-only">Collapse all</span>
        </Button>
        <IconButton label="Close and show worktree files" onClick={onClose}>
          <X size={14} />
        </IconButton>
      </div>
      <FileTreeList
        height={height}
        tree={tree}
        rowOptions={(node) => {
          const absolutePath = toAbsolutePath(directoryPath, node.path);
          return {
            absolutePath,
            isSelected: previewPath === absolutePath,
            onContextMenu: (event) => {
              event.preventDefault();
              void window.electronAPI.showFilePathContextMenu(worktreeId, absolutePath);
            },
            onFileClick: () => onPreviewSelectionChange({ path: absolutePath }),
            pastePath: absolutePath,
          };
        }}
      />
    </>
  );
}
