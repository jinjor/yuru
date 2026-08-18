import { GitBranch, LoaderCircle, MoreVertical, Plus, Trash2 } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from "react";
import type { PrimarySessionListItem, RepoListItem, WorktreeListItem } from "../../shared/metadata";
import { worktreeLabelText } from "./worktreeLabel";
import { GitHubBadge } from "../pull-requests/GitHubBadge";
import { SessionProviderDot } from "../providers/SessionProviderDot";
import { EmptyState } from "../ui/EmptyState";
import { IconButton } from "../ui/IconButton";
import { useReorderDrag, type ReorderDrag } from "../utils/useReorderDrag";

interface RepoListProps {
  repos: RepoListItem[];
  selectedWorktreeId: string | null;
  removingWorktreeIds: ReadonlySet<string>;
  onCreateWorktree: (repoPath: string) => void;
  onSelectWorktree: (worktree: WorktreeListItem) => void;
  onRequestRemoveWorktree: (worktreeId: string) => void;
  onReorderRepos: (repoIds: string[]) => void;
  onReorderWorktrees: (repoId: string, worktreePaths: string[]) => void;
}

export function RepoList({
  repos,
  selectedWorktreeId,
  removingWorktreeIds,
  onCreateWorktree,
  onSelectWorktree,
  onRequestRemoveWorktree,
  onReorderRepos,
  onReorderWorktrees,
}: RepoListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [openMenuWorktreeId, setOpenMenuWorktreeId] = useState<string | null>(null);
  // 掴むのは repo のヘッダ行だけで、動くのは配下の worktree を含む repo group 全体。
  const reorder = useReorderDrag({
    itemIds: repos.map((repo) => repo.id),
    containerRef: listRef,
    onReorder: onReorderRepos,
  });

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
    return <EmptyState>No repositories</EmptyState>;
  }

  return (
    <div ref={listRef} className="repo-list" onClick={() => setOpenMenuWorktreeId(null)}>
      {repos.map((repo) => (
        <RepoGroup
          key={repo.id}
          repo={repo}
          listRef={listRef}
          repoReorder={reorder}
          selectedWorktreeId={selectedWorktreeId}
          removingWorktreeIds={removingWorktreeIds}
          openMenuWorktreeId={openMenuWorktreeId}
          setOpenMenuWorktreeId={setOpenMenuWorktreeId}
          onCreateWorktree={onCreateWorktree}
          onSelectWorktree={onSelectWorktree}
          onRequestRemoveWorktree={onRequestRemoveWorktree}
          onReorderWorktrees={onReorderWorktrees}
        />
      ))}
    </div>
  );
}

interface RepoGroupProps {
  repo: RepoListItem;
  // worktree の並び替えもサイドバー全体をスクロールするので、repo と同じコンテナで測る。
  listRef: RefObject<HTMLDivElement | null>;
  repoReorder: ReorderDrag;
  selectedWorktreeId: string | null;
  removingWorktreeIds: ReadonlySet<string>;
  openMenuWorktreeId: string | null;
  setOpenMenuWorktreeId: Dispatch<SetStateAction<string | null>>;
  onCreateWorktree: (repoPath: string) => void;
  onSelectWorktree: (worktree: WorktreeListItem) => void;
  onRequestRemoveWorktree: (worktreeId: string) => void;
  onReorderWorktrees: (repoId: string, worktreePaths: string[]) => void;
}

function RepoGroup({
  repo,
  listRef,
  repoReorder,
  selectedWorktreeId,
  removingWorktreeIds,
  openMenuWorktreeId,
  setOpenMenuWorktreeId,
  onCreateWorktree,
  onSelectWorktree,
  onRequestRemoveWorktree,
  onReorderWorktrees,
}: RepoGroupProps) {
  // 並び替えは repo をまたがないので、掴めるのはこの repo の task worktree だけ。
  const worktreeReorder = useReorderDrag({
    itemIds: repo.taskWorktrees.map((worktree) => worktree.worktreePath),
    containerRef: listRef,
    onReorder: (worktreePaths) => onReorderWorktrees(repo.id, worktreePaths),
  });

  return (
    <div
      className={["repo-group", repoReorder.itemClassName(repo.id)].join(" ").trim()}
      style={repoReorder.itemStyle(repo.id)}
      data-reorder-id={repo.id}
    >
      <div
        className="repo-row"
        title={repo.repoPath}
        onPointerDown={(event) => repoReorder.onItemPointerDown(repo.id, event)}
      >
        <div className="repo-row-text">
          <span className="repo-name">{repo.repoPath.split("/").pop() || repo.repoPath}</span>
          <span className="repo-path">{repo.repoPath}</span>
        </div>
        <IconButton
          className="repo-row-new-btn"
          label="New worktree"
          onClick={() => onCreateWorktree(repo.repoPath)}
        >
          <Plus size={15} strokeWidth={2} aria-hidden="true" />
        </IconButton>
      </div>
      <div className="repo-task-worktrees">
        {[repo.mainWorktree, ...repo.taskWorktrees].map((worktree) => (
          <WorktreeCard
            key={worktree.worktreeId}
            worktree={worktree}
            selectedWorktreeId={selectedWorktreeId}
            isRemoving={removingWorktreeIds.has(worktree.worktreeId)}
            isMenuOpen={openMenuWorktreeId === worktree.worktreeId}
            // main worktree は常に先頭なので掴めず、落とす先にもならない。
            reorder={worktree.isMainWorktree === true ? null : worktreeReorder}
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
  );
}

interface WorktreeCardProps {
  worktree: WorktreeListItem;
  selectedWorktreeId: string | null;
  isRemoving: boolean;
  isMenuOpen: boolean;
  // 並び替えられないカード (main worktree) では null。
  reorder: ReorderDrag | null;
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
  reorder,
  onCloseMenu,
  onToggleMenu,
  onSelectWorktree,
  onRequestRemoveWorktree,
}: WorktreeCardProps) {
  const { suggestedSessions } = worktree;
  const primarySession = worktree.primarySessions[0];
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
        reorder?.itemClassName(worktree.worktreePath) ?? "",
      ].join(" ")}
      style={reorder?.itemStyle(worktree.worktreePath)}
      data-reorder-id={reorder ? worktree.worktreePath : undefined}
      title={worktree.worktreePath}
      role="button"
      aria-disabled={isRemoving}
      tabIndex={isRemoving ? -1 : 0}
      onPointerDown={(event) => reorder?.onItemPointerDown(worktree.worktreePath, event)}
      onClick={handleCardClick}
      onKeyDown={handleCardKeyDown}
    >
      {showOverflowMenu && (
        <IconButton
          className="task-worktree-overflow"
          label="More actions"
          onClick={(event) => {
            event.stopPropagation();
            onToggleMenu();
          }}
        >
          <MoreVertical size={15} strokeWidth={2} aria-hidden="true" />
        </IconButton>
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
