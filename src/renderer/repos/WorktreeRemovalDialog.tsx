import { AlertTriangle, GitBranch, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { WorktreeProcessInfo } from "../../shared/ipc";
import type { WorktreeListItem } from "../../shared/metadata";
import { worktreeLabelText } from "./worktreeLabel";
import { Modal } from "../shared/Modal";

interface WorktreeRemovalDialogProps {
  worktree: WorktreeListItem;
  topOffset: number;
  onClose: () => void;
  onReady: (worktreeId: string, force: boolean) => void;
}

// 削除準備の確認ダイアログ。通常 (A) / open PR 警告付き (B) / force (C) を出し分ける。
// dirty、Yuru セッションの停止、残存プロセスの停止確認をこの中で完結させ、ready に
// なった時だけ閉じる。時間のかかる Git 削除は onReady 後にカード側で表示する。
export function WorktreeRemovalDialog({
  worktree,
  topOffset,
  onClose,
  onReady,
}: WorktreeRemovalDialogProps) {
  const [mode, setMode] = useState<"confirm" | "force">("confirm");
  const [blockingProcesses, setBlockingProcesses] = useState<WorktreeProcessInfo[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [busy, onClose]);

  const prepareRemoval = async (
    force: boolean,
    processesToStop?: WorktreeProcessInfo[],
  ): Promise<void> => {
    setBusy(true);
    try {
      const result = await window.electronAPI.prepareWorktreeRemoval(
        worktree.worktreeId,
        force,
        processesToStop?.map(({ pid, command }) => ({ pid, command })),
      );
      setBusy(false);
      if (!result.ok) {
        return;
      }
      switch (result.data.status) {
        case "ready":
          onReady(worktree.worktreeId, force);
          return;
        case "dirty":
          setBlockingProcesses(null);
          setMode("force");
          return;
        case "process_alive":
          setBlockingProcesses(result.data.processes);
          return;
      }
    } catch (error) {
      setBusy(false);
      console.error("Failed to prepare worktree removal.", error);
    }
  };

  const isForce = mode === "force";
  const hasOpenPullRequest =
    worktree.githubPullRequest?.state === "open" || worktree.githubPullRequest?.state === "draft";

  return (
    <Modal onClose={() => !busy && onClose()} topOffset={topOffset}>
      <div className={`removal-dialog ${blockingProcesses ? "processes" : ""}`}>
        <div className={`removal-dialog-head ${isForce ? "danger" : ""}`}>
          {isForce ? (
            <AlertTriangle size={16} strokeWidth={2} aria-hidden="true" />
          ) : (
            <Trash2 size={16} strokeWidth={2} aria-hidden="true" />
          )}
          {isForce ? "Force remove worktree" : "Remove worktree"}
        </div>
        <div className="removal-dialog-body">
          <div className="removal-target">
            <span className="removal-target-name">
              <GitBranch size={12} strokeWidth={2} aria-hidden="true" />
              {worktreeLabelText(worktree)}
            </span>
            <span className="removal-target-dir" title={worktree.worktreePath}>
              {worktree.worktreePath}
            </span>
          </div>
          {blockingProcesses ? (
            <>
              <p className="removal-text removal-process-summary">
                <b>
                  {blockingProcesses.length} process{blockingProcesses.length === 1 ? "" : "es"}{" "}
                  {blockingProcesses.length === 1 ? "is" : "are"} still using this worktree.
                </b>{" "}
                {blockingProcesses.length === 1 ? "It" : "They"} must be stopped before the worktree
                can be removed.
              </p>
              <ul className="removal-process-list">
                {blockingProcesses.map((processInfo) => (
                  <li key={processInfo.pid} className="removal-process-item">
                    <span className="removal-process-mark" aria-hidden="true" />
                    <div className="removal-process-content">
                      <code className="removal-process-command">{processInfo.command}</code>
                      <span className="removal-process-meta">PID {processInfo.pid}</span>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="removal-process-caution">
                <AlertTriangle size={13} strokeWidth={2} aria-hidden="true" />
                Stopping {blockingProcesses.length === 1 ? "it" : "them"} may discard unsaved work.
              </p>
            </>
          ) : isForce ? (
            <>
              <div className="removal-note force">
                This worktree has <b>uncommitted work</b>, so it can&apos;t be removed normally.
                Forcing will throw it away.
              </div>
              <p className="removal-text">
                <b>Uncommitted changes and untracked files will be discarded.</b> The <b>branch</b>{" "}
                and <b>session history</b> are kept.
              </p>
            </>
          ) : hasOpenPullRequest ? (
            <>
              <div className="removal-note pr">
                This worktree has an <b>open pull request</b>. Removing it won&apos;t touch the PR
                or the branch — but you&apos;ll lose the link to this work in Yuru.
              </div>
              <p className="removal-text">
                Removes the worktree and its list entry. The <b>PR</b>, <b>branch</b>, and{" "}
                <b>session history</b> are kept.
              </p>
            </>
          ) : (
            <p className="removal-text">
              Removes the <b>worktree directory</b> and its entry from this list. The <b>branch</b>{" "}
              and <b>session history</b> are kept — you can resume them later.
            </p>
          )}
        </div>
        <div className="removal-foot">
          {blockingProcesses ? (
            <>
              <button type="button" className="removal-btn ghost" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button
                type="button"
                className="removal-btn danger"
                onClick={() => void prepareRemoval(isForce, blockingProcesses)}
                disabled={busy}
              >
                {blockingProcesses.length === 1 ? "Stop" : "Stop all"}
                {isForce ? " and force remove" : " and remove"}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="removal-btn ghost" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button
                type="button"
                className="removal-btn danger"
                onClick={() => void prepareRemoval(isForce)}
                disabled={busy}
              >
                {isForce ? "Force remove" : hasOpenPullRequest ? "Remove anyway" : "Remove"}
              </button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
