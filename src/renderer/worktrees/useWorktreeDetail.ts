import { useCallback, useEffect, useRef, useState } from "react";
import type { PrimarySessionListItem, WorktreeDetail } from "../../shared/metadata";

export interface WorktreeDetailStore {
  detail: WorktreeDetail;
  // session の開始・解除のように、結果を待ってから表示を切り替えたい操作のための取り直し。
  refresh: () => Promise<void>;
  // ホームとタブの並び替え。渡すのはこの worktree の全 primary session の key。
  reorderPrimarySessions: (agentSessionKeys: string[]) => void;
}

function emptyWorktreeDetail(worktreeId: string): WorktreeDetail {
  return {
    worktreeId,
    primarySessions: [],
    activeTerminalRuntimeIds: [],
    githubPullRequest: null,
  };
}

// この worktree の表示状態を取得し、この worktree の変更だけを購読する。取得は初期値と
// 取り直しのためで、以降の更新は push が置き換える。取得は push を追い越しうるので、
// push と書き込みは走っている取得を無効にしてから state を書く。
export function useWorktreeDetail(worktreeId: string): WorktreeDetailStore {
  const [detail, setDetail] = useState<WorktreeDetail>(() => emptyWorktreeDetail(worktreeId));
  const requestRef = useRef(0);

  const refresh = useCallback(async (): Promise<void> => {
    const requestId = ++requestRef.current;
    try {
      const nextDetail = await window.electronAPI.getWorktreeDetail(worktreeId);
      if (requestRef.current === requestId) {
        setDetail(nextDetail);
      }
    } catch (error) {
      console.error("Failed to load the worktree state.", error);
    }
  }, [worktreeId]);

  useEffect(() => {
    // IPC の初期取得。state の更新は応答を await した後に行う。
    // oxlint-disable-next-line react/set-state-in-effect
    void refresh();
    return window.electronAPI.onWorktreeDetailChanged((nextDetail) => {
      if (nextDetail.worktreeId !== worktreeId) {
        return;
      }
      requestRef.current += 1;
      setDetail(nextDetail);
    });
  }, [refresh, worktreeId]);

  const reorderPrimarySessions = useCallback(
    (agentSessionKeys: string[]): void => {
      // 書き込みの結果が push で戻るまで、ドロップした並びを描き続ける。
      requestRef.current += 1;
      setDetail((prev) => ({
        ...prev,
        primarySessions: sortPrimarySessionsByKeys(prev.primarySessions, agentSessionKeys),
      }));
      window.electronAPI
        .reorderPrimarySessions(worktreeId, agentSessionKeys)
        .then((result) => {
          if (result.ok) {
            return;
          }
          // ドラッグ中に session が増減していた場合。並びは書かれないので取り直す。
          void refresh();
        })
        .catch((error: unknown) => {
          // 書き込みの失敗は main が error center に残す。ここでは表示を実態に戻すだけ。
          console.error("Failed to reorder primary sessions.", error);
          void refresh();
        });
    },
    [refresh, worktreeId],
  );

  return { detail, refresh, reorderPrimarySessions };
}

function sortPrimarySessionsByKeys(
  primarySessions: readonly PrimarySessionListItem[],
  agentSessionKeys: readonly string[],
): PrimarySessionListItem[] {
  const orderByKey = new Map(agentSessionKeys.map((key, index) => [key, index]));
  const toOrder = (session: PrimarySessionListItem): number =>
    (session.agentSessionKey === null ? undefined : orderByKey.get(session.agentSessionKey)) ??
    agentSessionKeys.length;
  return [...primarySessions].sort((a, b) => toOrder(a) - toOrder(b));
}
