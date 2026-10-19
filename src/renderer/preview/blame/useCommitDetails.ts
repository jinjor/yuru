import { useCallback, useState } from "react";
import type { CommitPullRequest, GitDiffScope } from "../../../shared/ipc";
import { resultDataOrNull } from "../../utils/result";

// カードの中身。undefined は取得中、null は取れなかったこと。
export interface CommitDetails {
  message: string | null | undefined;
  pullRequests: CommitPullRequest[] | null | undefined;
}

interface UseCommitDetailsOptions {
  worktreeId: string;
  path: string;
  scope: GitDiffScope | undefined;
}

const NO_DETAILS: ReadonlyMap<string, CommitDetails> = new Map();

// カードの中身を、表示中のファイル 1 つ分だけ commit ごとに持つ。ファイルや scope が変わったら
// 前の結果は使わない。
export function useCommitDetails({ worktreeId, path, scope }: UseCommitDetailsOptions): {
  commitDetails: ReadonlyMap<string, CommitDetails>;
  // カードを開いたときに呼ぶ。同じファイルを表示している間は、同じ commit を取り直さない。
  requestCommitDetails: (oid: string) => void;
} {
  const fileKey = JSON.stringify([worktreeId, path, scope ?? null]);
  const [details, setDetails] = useState<{
    fileKey: string;
    byOid: ReadonlyMap<string, CommitDetails>;
  } | null>(null);

  const commitDetails = details?.fileKey === fileKey ? details.byOid : NO_DETAILS;

  const updateCommitDetails = useCallback(
    (oid: string, patch: Partial<CommitDetails>) => {
      setDetails((current) => {
        const entry = current?.fileKey === fileKey ? current.byOid.get(oid) : undefined;
        // 別のファイルに切り替わった後や、その間に項目が捨てられた後に届いた応答は捨てる。
        // 項目を作り直すと、もう片方の応答が届かないまま「取得中」で残る。
        if (!current || !entry) {
          return current;
        }
        return { fileKey, byOid: new Map(current.byOid).set(oid, { ...entry, ...patch }) };
      });
    },
    [fileKey],
  );

  const requestCommitDetails = useCallback(
    (oid: string) => {
      if (commitDetails.has(oid)) {
        return;
      }
      setDetails((current) => {
        const byOid = new Map(current?.fileKey === fileKey ? current.byOid : []);
        byOid.set(oid, { message: undefined, pullRequests: undefined });
        return { fileKey, byOid };
      });
      void window.electronAPI.getGitCommitMessage(worktreeId, oid).then((result) => {
        updateCommitDetails(oid, { message: resultDataOrNull(result) });
      });
      void window.electronAPI.getCommitPullRequests(worktreeId, oid).then((result) => {
        updateCommitDetails(oid, { pullRequests: resultDataOrNull(result) });
      });
    },
    [commitDetails, fileKey, updateCommitDetails, worktreeId],
  );

  return { commitDetails, requestCommitDetails };
}
