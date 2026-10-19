import { useEffect, useState } from "react";
import type { GitBlame, GitDiffScope, GitPathState } from "../../../shared/ipc";

export type BlameLoad =
  | { status: "loading" }
  // blame が null なのは、表示側にファイルが無いとき。
  | { status: "ready"; blame: GitBlame | null }
  | { status: "failed" };

interface UseBlameOptions {
  worktreeId: string;
  path: string;
  scope: GitDiffScope | undefined;
  // 取りに行ってよいか。フォーカス行があり、このファイルをソースとして表示しているときだけ true。
  enabled: boolean;
  // 以下は取り直しのきっかけ。表示側の内容、そのファイルの git の状態、HEAD のどれかが変わったら
  // 取り直す (内容が同じでも、commit や stage で未コミットの行が変わり、rebase や amend で commit が
  // 作り直される)。
  currentContent: string | null;
  gitPathState: GitPathState | undefined;
  headSha: string | null;
}

const LOADING: BlameLoad = { status: "loading" };

// 表示中のファイル 1 つ分の blame。ファイルや scope が変わったら前の結果は使わない。
export function useBlame({
  worktreeId,
  path,
  scope,
  enabled,
  currentContent,
  gitPathState,
  headSha,
}: UseBlameOptions): BlameLoad {
  const fileKey = JSON.stringify([worktreeId, path, scope ?? null]);
  const gitPathStateKey = JSON.stringify(gitPathState ?? null);
  const [loaded, setLoaded] = useState<{ fileKey: string; load: BlameLoad } | null>(null);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let cancelled = false;
    void window.electronAPI.getGitBlame(worktreeId, path, scope).then((result) => {
      // 取得中に内容やファイルが変わったら、その応答は古いので使わない。
      if (cancelled) {
        return;
      }
      setLoaded({
        fileKey,
        load: result.ok ? { status: "ready", blame: result.data } : { status: "failed" },
      });
    });
    return () => {
      cancelled = true;
    };
  }, [currentContent, enabled, fileKey, gitPathStateKey, headSha, path, scope, worktreeId]);

  return loaded?.fileKey === fileKey ? loaded.load : LOADING;
}
