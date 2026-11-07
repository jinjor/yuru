import { type MouseEvent, useEffect, useRef } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { FileTreeNode } from "../../shared/ipc";
import { EmptyState } from "../ui/EmptyState";
import { beginPastePathDrag, endPastePathDrag, setFileDownloadDrag } from "../utils/fileDrag";
import type { VisibleTreeRow } from "./fileTree";
import type { DirectoryTree, DirectoryTreeRevealRequest } from "./useDirectoryTree";

// ツリーを表示しているコンポーネントへ、外から頼む操作。
export interface FileTreeHandle {
  // 親まで展開してディレクトリ自身も展開し、その行へスクロールする。path はツリーのルートからの相対パス。
  revealDirectory: (relativePath: string) => void;
}

// 行ごとに、呼び出し側が決める部分。
export interface FileTreeRowOptions {
  // 実体のパス。Finder などアプリの外へファイルをドロップしたときに、これをコピーさせる。
  absolutePath: string;
  isSelected: boolean;
  // 名前の色分けなど、呼び出し側が名前に足す見た目。
  nameClassName?: string;
  onContextMenu: (event: MouseEvent<HTMLElement>) => void;
  // ファイル行のクリック。ディレクトリ行のクリックは開閉になる。
  onFileClick: () => void;
  // ターミナルへドロップしたときに貼るパス。
  pastePath: string;
}

interface FileTreeListProps {
  height: number;
  rowOptions: (node: FileTreeNode) => FileTreeRowOptions;
  tree: DirectoryTree;
}

// ツリーの行の一覧。ディレクトリ行のクリックで開閉し、reveal で見せた行へスクロールする。
export function FileTreeList({ height, rowOptions, tree }: FileTreeListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const lastScrolledRequestRef = useRef<DirectoryTreeRevealRequest | null>(null);
  const { loadingDirectories, revealRequest, rows, status, toggleDirectory } = tree;

  useEffect(() => {
    if (!revealRequest || lastScrolledRequestRef.current === revealRequest) {
      return;
    }
    lastScrolledRequestRef.current = revealRequest;
    const revealedRow = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>(".file-tree-row") ?? [],
    ).find((row) => row.dataset.path === revealRequest.path);
    // ディレクトリは展開した中身が続くので、行を上端に寄せる。
    revealedRow?.scrollIntoView({
      block: revealRequest.kind === "directory" ? "start" : "nearest",
    });
  }, [revealRequest]);

  return (
    <div ref={listRef} className="file-tree" style={{ height }}>
      {status === "loading" ? (
        <EmptyState>Loading files...</EmptyState>
      ) : status === "ready" ? (
        rows.map((row) => (
          <FileTreeRow
            key={row.node.id}
            isLoading={loadingDirectories.has(row.node.path)}
            onToggleDirectory={() => toggleDirectory(row.node.path)}
            options={rowOptions(row.node)}
            row={row}
          />
        ))
      ) : (
        <EmptyState>No files</EmptyState>
      )}
    </div>
  );
}

interface FileTreeRowProps {
  isLoading: boolean;
  onToggleDirectory: () => void;
  options: FileTreeRowOptions;
  row: VisibleTreeRow;
}

// ツリーの 1 行の見た目。インデント・開閉の矢印・名前を出し、ドラッグで運べるようにする。
function FileTreeRow({ isLoading, onToggleDirectory, options, row }: FileTreeRowProps) {
  const { absolutePath, isSelected, nameClassName, onContextMenu, onFileClick, pastePath } =
    options;
  const { depth, isOpen, node } = row;
  const isDirectory = node.kind === "directory";

  return (
    <div
      className={`file-tree-row ${isSelected ? "selected" : ""}`}
      data-path={node.path}
      draggable
      onContextMenu={onContextMenu}
      onDragEnd={(event) => endPastePathDrag(event.currentTarget)}
      onDragStart={(event) => {
        beginPastePathDrag(event.dataTransfer, event.currentTarget, pastePath);
        if (!isDirectory) {
          setFileDownloadDrag(event.dataTransfer, absolutePath, node.name);
        }
      }}
      onClick={isDirectory ? onToggleDirectory : onFileClick}
      style={{ height: 28, paddingLeft: 12 + depth * 12 }}
    >
      <span className={`file-tree-caret ${isDirectory ? "directory" : "file"}`}>
        {isDirectory ? (
          isOpen ? (
            <ChevronDown size={15} strokeWidth={2.4} />
          ) : (
            <ChevronRight size={15} strokeWidth={2.4} />
          )
        ) : null}
      </span>
      <span className={`file-tree-name ${node.kind} ${nameClassName ?? ""}`}>
        {node.name}
        {isLoading ? "..." : ""}
      </span>
    </div>
  );
}
