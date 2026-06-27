import { AlertTriangle, GitBranch, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { WorktreeListItem } from "../../shared/metadata";
import { worktreeLabelText } from "../utils/worktree";
import { Modal } from "./Modal";

interface WorktreeRemovalDialogProps {
  worktree: WorktreeListItem;
  topOffset: number;
  onClose: () => void;
  onRemoved: (worktreeId: string) => void;
}

// 削除フロー (→ docs/backlog-details/F41-worktree-removal.md) の確認ダイアログ。
// 通常 (A) / open PR 警告付き (B) / force (C) を出し分け、削除直前のチェックで生プロセスが
// 判明したときは新しいモーダルを開かず本文をブロック表示に差し替える。
export function WorktreeRemovalDialog({
  worktree,
  topOffset,
  onClose,
  onRemoved,
}: WorktreeRemovalDialogProps) {
  const [mode, setMode] = useState<"confirm" | "force">("confirm");
  const [blockedByProcess, setBlockedByProcess] = useState(false);
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

  const requestRemove = async (force: boolean): Promise<void> => {
    setBusy(true);
    const result = await window.electronAPI.removeWorktree(worktree.worktreeId, force);
    setBusy(false);
    if (!result.ok) {
      // git/unknown の失敗は error center に出るので、ここはダイアログを閉じるだけ。
      onClose();
      return;
    }
    switch (result.data.status) {
      case "removed":
        onRemoved(worktree.worktreeId);
        return;
      case "dirty":
        setMode("force");
        return;
      case "process_alive":
        setBlockedByProcess(true);
        return;
    }
  };

  const isForce = mode === "force";
  const hasOpenPullRequest = worktree.githubPullRequest?.state === "open";

  return (
    <Modal onClose={onClose} topOffset={topOffset}>
      <div className="removal-dialog">
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
          {blockedByProcess ? (
            <p className="removal-text">
              This worktree still has a <b>running process</b> using it. Stop it first, then remove.
            </p>
          ) : isForce ? (
            <>
              <div className="removal-note force">
                This worktree has <b>uncommitted work</b>, so a normal remove was refused. Forcing
                will throw it away.
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
          {blockedByProcess ? (
            <button type="button" className="removal-btn ghost" onClick={onClose}>
              Close
            </button>
          ) : (
            <>
              <button type="button" className="removal-btn ghost" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button
                type="button"
                className="removal-btn danger"
                onClick={() => void requestRemove(isForce)}
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
