import { AlertTriangle, GitBranch, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { WorktreeProcessInfo } from "../../shared/ipc";
import type { WorktreeListItem } from "../../shared/metadata";
import { worktreeLabelText } from "../utils/worktree";
import { Modal } from "./Modal";

interface WorktreeRemovalDialogProps {
  worktree: WorktreeListItem;
  topOffset: number;
  onClose: () => void;
  onRemoved: (worktreeId: string) => void;
}

// 削除フローの確認ダイアログ。通常 (A) / open PR 警告付き (B) / force (C) を出し分ける。
// Yuru が起動したセッションは削除時に自動で止める。その後もプロセスが worktree を握って
// いるときは詳細一覧へ差し替え、全件の停止と削除を一つの明示操作として確認する。
export function WorktreeRemovalDialog({
  worktree,
  topOffset,
  onClose,
  onRemoved,
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

  const requestRemove = async (
    force: boolean,
    processesToStop?: WorktreeProcessInfo[],
  ): Promise<void> => {
    setBusy(true);
    const result = await window.electronAPI.removeWorktree(
      worktree.worktreeId,
      force,
      processesToStop?.map(({ pid, command }) => ({ pid, command })),
    );
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
        setBlockingProcesses(null);
        setMode("force");
        return;
      case "process_alive":
        setBlockingProcesses(result.data.processes);
        return;
    }
  };

  const isForce = mode === "force";
  const hasOpenPullRequest =
    worktree.githubPullRequest?.state === "open" || worktree.githubPullRequest?.state === "draft";

  return (
    <Modal onClose={onClose} topOffset={topOffset}>
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
          {blockingProcesses ? (
            <>
              <button type="button" className="removal-btn ghost" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button
                type="button"
                className="removal-btn danger"
                onClick={() => void requestRemove(isForce, blockingProcesses)}
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
