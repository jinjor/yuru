import { GitBranch, LoaderCircle, MoreVertical, Trash2 } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import type { PrimarySessionListItem, RepoListItem, WorktreeListItem } from "../../shared/metadata";
import { worktreeLabelText } from "../utils/worktree";
import { GitHubBadge } from "./GitHubBadge";
import { SessionProviderDot } from "./SessionProviderDot";

interface RepoListProps {
  repos: RepoListItem[];
  selectedWorktreeId: string | null;
  removingWorktreeIds: ReadonlySet<string>;
  onCreateWorktree: (repoPath: string) => void;
  onSelectWorktree: (worktree: WorktreeListItem) => void;
  onRequestRemoveWorktree: (worktreeId: string) => void;
}

export function RepoList({
  repos,
  selectedWorktreeId,
  removingWorktreeIds,
  onCreateWorktree,
  onSelectWorktree,
  onRequestRemoveWorktree,
}: RepoListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [openMenuWorktreeId, setOpenMenuWorktreeId] = useState<string | null>(null);

  useEffect(() => {
    if (!openMenuWorktreeId) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (listRef.current?.contains(event.target as Node)) {
        return;
      }
      setOpenMenuWorktreeId(null);
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [openMenuWorktreeId]);

  if (repos.length === 0) {
    return <div className="repo-list-empty">No repositories</div>;
  }

  return (
    <div ref={listRef} className="repo-list" onClick={() => setOpenMenuWorktreeId(null)}>
      {repos.map((repo) => (
        <div key={repo.id} className="repo-group">
          <div className="repo-row" title={repo.repoPath}>
            <div className="repo-row-text">
              <span className="repo-name">{repo.repoPath.split("/").pop() || repo.repoPath}</span>
              <span className="repo-path">{repo.repoPath}</span>
            </div>
            <button
              className="repo-row-new-btn"
              onClick={() => onCreateWorktree(repo.repoPath)}
              title="New worktree"
            >
              +
            </button>
          </div>
          <div className="repo-task-worktrees">
            {[repo.mainWorktree, ...repo.taskWorktrees].map((worktree) => (
              <WorktreeCard
                key={worktree.worktreeId}
                worktree={worktree}
                selectedWorktreeId={selectedWorktreeId}
                isRemoving={removingWorktreeIds.has(worktree.worktreeId)}
                isMenuOpen={openMenuWorktreeId === worktree.worktreeId}
                onCloseMenu={() => setOpenMenuWorktreeId(null)}
                onToggleMenu={() => {
                  setOpenMenuWorktreeId((prev) =>
                    prev === worktree.worktreeId ? null : worktree.worktreeId,
                  );
                }}
                onSelectWorktree={onSelectWorktree}
                onRequestRemoveWorktree={onRequestRemoveWorktree}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

interface WorktreeCardProps {
  worktree: WorktreeListItem;
  selectedWorktreeId: string | null;
  isRemoving: boolean;
  isMenuOpen: boolean;
  onCloseMenu: () => void;
  onToggleMenu: () => void;
  onSelectWorktree: (worktree: WorktreeListItem) => void;
  onRequestRemoveWorktree: (worktreeId: string) => void;
}

function WorktreeCard({
  worktree,
  selectedWorktreeId,
  isRemoving,
  isMenuOpen,
  onCloseMenu,
  onToggleMenu,
  onSelectWorktree,
  onRequestRemoveWorktree,
}: WorktreeCardProps) {
  const { primarySession, suggestedSessions } = worktree;
  const isSelected = selectedWorktreeId === worktree.worktreeId;
  const isPrimarySessionActive = primarySession?.state === "active";
  // main worktree は削除対象外。task worktree にだけ ︙ メニューを出す。
  const showOverflowMenu = worktree.isMainWorktree !== true && !isRemoving;

  const selectWorktree = () => {
    if (isRemoving) {
      return;
    }
    onCloseMenu();
    onSelectWorktree(worktree);
  };

  const handleCardClick = (event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
    selectWorktree();
  };

  const handleCardKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    selectWorktree();
  };

  return (
    <div
      className={[
        "task-worktree-card",
        primarySession ? "has-primary" : "no-primary",
        isPrimarySessionActive ? "active" : "inactive",
        isSelected ? "selected" : "",
        isMenuOpen ? "action-open" : "",
        isRemoving ? "removing" : "",
      ].join(" ")}
      title={worktree.worktreePath}
      role="button"
      aria-disabled={isRemoving}
      tabIndex={isRemoving ? -1 : 0}
      onClick={handleCardClick}
      onKeyDown={handleCardKeyDown}
    >
      {showOverflowMenu && (
        <button
          type="button"
          className="task-worktree-overflow"
          title="More actions"
          aria-label="More actions"
          onClick={(event) => {
            event.stopPropagation();
            onToggleMenu();
          }}
        >
          <MoreVertical size={15} strokeWidth={2} aria-hidden="true" />
        </button>
      )}
      {isMenuOpen && (
        <WorktreeCardMenu
          onRemove={() => {
            onCloseMenu();
            onRequestRemoveWorktree(worktree.worktreeId);
          }}
          onClick={(event) => event.stopPropagation()}
        />
      )}
      <div className="task-worktree-summary">
        <span className="task-worktree-heading">
          <span className="task-worktree-name" title={worktreeLabelText(worktree)}>
            {renderWorktreeLabel(worktree)}
          </span>
          {worktree.isMainWorktree === true && worktree.headCommittedAt !== undefined && (
            <time
              className="task-worktree-head-time"
              dateTime={new Date(worktree.headCommittedAt).toISOString()}
            >
              {formatHeadCommittedAt(worktree.headCommittedAt)}
            </time>
          )}
          {worktree.githubPullRequest && <GitHubBadge github={worktree.githubPullRequest} />}
        </span>
        {isRemoving ? (
          <span className="task-worktree-removing">
            <LoaderCircle size={12} strokeWidth={2} aria-hidden="true" />
            Removing…
          </span>
        ) : primarySession ? (
          <PrimarySessionSummary primarySession={primarySession} />
        ) : (
          <span className="task-worktree-hint">
            {worktree.isMainWorktree === true
              ? "terminal"
              : formatExistingSessionCount(suggestedSessions.length)}
          </span>
        )}
      </div>
    </div>
  );
}

interface PrimarySessionSummaryProps {
  primarySession: PrimarySessionListItem;
}

function PrimarySessionSummary({ primarySession }: PrimarySessionSummaryProps) {
  const preview = primarySession.preview || "(no messages)";
  return (
    <span className="task-worktree-session-row">
      <SessionProviderDot
        kind="primary"
        provider={primarySession.provider}
        state={primarySession.state}
        activityState={primarySession.activityState}
      />
      <span className="task-worktree-session-preview" title={preview}>
        {preview}
      </span>
    </span>
  );
}

interface WorktreeCardMenuProps {
  onRemove: () => void;
  onClick: (event: MouseEvent<HTMLDivElement>) => void;
}

function WorktreeCardMenu({ onRemove, onClick }: WorktreeCardMenuProps) {
  return (
    <div className="task-worktree-menu" onClick={onClick}>
      <button
        type="button"
        className="task-worktree-menu-item danger"
        onClick={onRemove}
        title="Remove this worktree"
      >
        <Trash2 size={14} strokeWidth={2} aria-hidden="true" />
        Remove worktree…
      </button>
    </div>
  );
}

function renderWorktreeLabel(worktree: WorktreeListItem): ReactNode {
  const text = worktreeLabelText(worktree);
  if (!worktree.branch || !worktree.headSha) {
    return text;
  }
  return (
    <>
      <GitBranch
        className="task-worktree-branch-icon"
        size={12}
        strokeWidth={2}
        aria-hidden="true"
      />
      {text}
    </>
  );
}

function formatExistingSessionCount(count: number): string {
  if (count === 0) {
    return "empty";
  }
  return `${count} existing session${count === 1 ? "" : "s"}`;
}

function formatHeadCommittedAt(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}
