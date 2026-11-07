import { Activity, type Ref, useCallback, useImperativeHandle, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { GitFileStatus, GitPathState } from "../../shared/ipc";
import { isExternalPath, type PreviewSelection } from "../preview/previewSelection";
import { toRootRelativePath } from "../utils/filePath";
import { ExternalDirectoryTree } from "./ExternalDirectoryTree";
import type { FileTreeHandle } from "./FileTreeList";
import { WorktreeFileTree } from "./WorktreeFileTree";

export interface FilesPaneHandle {
  // ディレクトリを展開して見せる。path は worktree 内なら worktree 基準の相対パス、外なら絶対パス。
  // 外のディレクトリは、表示中の外のツリーの中ならそこで展開し、そうでなければそれをルートにして表示する。
  showDirectory: (path: string) => void;
}

interface FilesPaneProps {
  changedFiles: readonly GitFileStatus[];
  gitPathStates: readonly GitPathState[];
  height: number;
  onPreviewSelectionChange: (selection: PreviewSelection | null) => void;
  previewSelection: PreviewSelection | null;
  ref?: Ref<FilesPaneHandle>;
  worktreeId: string;
  worktreePath: string;
}

// Files タブ。worktree のツリーと、一時的に開いた worktree 外のディレクトリのツリーのどちらかを表示する。
// 外のディレクトリを表示している間も、worktree のツリーは展開状態を保ったまま隠しておく。
export function FilesPane({
  changedFiles,
  gitPathStates,
  height,
  onPreviewSelectionChange,
  previewSelection,
  ref,
  worktreeId,
  worktreePath,
}: FilesPaneProps) {
  // 表示中の worktree 外のディレクトリの絶対パス。null なら worktree のツリーを表示する。
  const [externalDirectoryPath, setExternalDirectoryPath] = useState<string | null>(null);
  const worktreeTreeRef = useRef<FileTreeHandle>(null);
  const externalTreeRef = useRef<FileTreeHandle>(null);
  const closeExternalDirectory = useCallback((): void => {
    setExternalDirectoryPath(null);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      showDirectory(path: string): void {
        if (isExternalPath(path)) {
          const relativePath =
            externalDirectoryPath === null ? null : toRootRelativePath(externalDirectoryPath, path);
          if (relativePath === null) {
            setExternalDirectoryPath(path);
            return;
          }
          // ルート自身なら、見せる行が無いので何もしない。
          if (relativePath !== "") {
            if (!externalTreeRef.current) {
              throw new Error("External directory tree handle is missing while it is displayed");
            }
            externalTreeRef.current.revealDirectory(relativePath);
          }
          return;
        }
        // hidden の間 worktree のツリーの handle は外れているので、表示の切り替えを即座に反映してから呼ぶ。
        flushSync(() => {
          setExternalDirectoryPath(null);
        });
        if (!worktreeTreeRef.current) {
          throw new Error(
            "Worktree file tree handle is missing after closing the external directory",
          );
        }
        worktreeTreeRef.current.revealDirectory(path);
      },
    }),
    [externalDirectoryPath],
  );

  return (
    <>
      <Activity mode={externalDirectoryPath === null ? "visible" : "hidden"}>
        <WorktreeFileTree
          changedFiles={changedFiles}
          gitPathStates={gitPathStates}
          height={height}
          onPreviewSelectionChange={onPreviewSelectionChange}
          previewSelection={previewSelection}
          ref={worktreeTreeRef}
          worktreeId={worktreeId}
          worktreePath={worktreePath}
        />
      </Activity>
      {externalDirectoryPath !== null && (
        <ExternalDirectoryTree
          key={externalDirectoryPath}
          directoryPath={externalDirectoryPath}
          height={height}
          onClose={closeExternalDirectory}
          onPreviewSelectionChange={onPreviewSelectionChange}
          previewSelection={previewSelection}
          ref={externalTreeRef}
          worktreeId={worktreeId}
        />
      )}
    </>
  );
}
