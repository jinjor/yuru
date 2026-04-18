import { useState } from "react";
import { FolderTree, Trash2 } from "lucide-react";
import type { Session } from "../../shared/session";
import { formatTime, providerLabel, repoNameForSession } from "../utils/session";
import { GitHubBadge } from "./GitHubBadge";

interface SessionListProps {
  sessions: Session[];
  selectedId: string | null;
  deletingSessionId: string | null;
  onDeleteWorktree: (session: Session) => void;
  onOpenExternal: (url: string) => void;
  onSelect: (session: Session) => void;
}

export function SessionList({
  sessions,
  selectedId,
  deletingSessionId,
  onDeleteWorktree,
  onOpenExternal,
  onSelect,
}: SessionListProps) {
  const activeSessions = sessions.filter((session) => session.state !== "archived");
  const archivedSessions = sessions.filter((session) => session.state === "archived");
  const [showArchived, setShowArchived] = useState(false);

  return (
    <div className="session-list">
      {activeSessions.map((session) => (
        <SessionCard
          key={session.id}
          session={session}
          selectedId={selectedId}
          deletingSessionId={deletingSessionId}
          onDeleteWorktree={onDeleteWorktree}
          onOpenExternal={onOpenExternal}
          onSelect={onSelect}
        />
      ))}
      {archivedSessions.length > 0 && (
        <>
          <div className="archived-toggle" onClick={() => setShowArchived(!showArchived)}>
            {showArchived ? "▼" : "▶"} Archived ({archivedSessions.length})
          </div>
          {showArchived &&
            archivedSessions.map((session) => (
              <div key={session.id} className="session-card archived">
                <div className="session-header">
                  <div className="session-heading">
                    <span
                      className={`session-provider-dot provider-${session.provider} archived`}
                      title={`${providerLabel(session.provider)} · archived`}
                    />
                    <div className="session-title-group">
                      <div className="session-preview-row">
                        <div className="session-preview primary" title={session.lastMessage || "(no messages)"}>
                          {session.lastMessage || "(no messages)"}
                        </div>
                      </div>
                      <div className="session-subtitle-row">
                        <span className="session-project">{repoNameForSession(session)}</span>
                        <span className="session-time">{formatTime(session.timestamp)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
        </>
      )}
    </div>
  );
}

function SessionCard({
  session,
  selectedId,
  deletingSessionId,
  onDeleteWorktree,
  onOpenExternal,
  onSelect,
}: {
  session: Session;
  selectedId: string | null;
  deletingSessionId: string | null;
  onDeleteWorktree: (session: Session) => void;
  onOpenExternal: (url: string) => void;
  onSelect: (session: Session) => void;
}) {
  return (
    <div
      className={`session-card ${session.state} ${session.worktree ? "has-worktree" : ""} ${selectedId === session.id ? "selected" : ""}`}
      onClick={() => onSelect(session)}
    >
      <div className="session-header">
        <div className="session-heading">
          <span
            className={`session-provider-dot provider-${session.provider} ${session.state}`}
            title={`${providerLabel(session.provider)} · ${session.state}`}
          />
          <div className="session-title-group">
            <div className="session-preview-row">
              <div className="session-preview primary" title={session.lastMessage || "(no messages)"}>
                {session.lastMessage || "(no messages)"}
              </div>
            </div>
            <div className="session-subtitle-row">
              <span className="session-project" title={repoNameForSession(session)}>
                {repoNameForSession(session)}
              </span>
              <span className="session-time">{formatTime(session.timestamp)}</span>
            </div>
            {session.worktree && (
              <div className="session-worktree-row">
                <span
                  className="session-worktree-indicator"
                  title={`Worktree: ${session.worktree.name}`}
                  aria-label={`Worktree ${session.worktree.name}`}
                >
                  <FolderTree size={11} strokeWidth={2} />
                </span>
                <span className="session-worktree-branch" title={session.worktree.branch}>
                  {session.worktree.branch}
                </span>
                {session.github && (
                  <GitHubBadge
                    github={session.github}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (session.github?.url) {
                        onOpenExternal(session.github.url);
                      }
                    }}
                  />
                )}
              </div>
            )}
          </div>
        </div>
        {session.worktree && (
          <button
            className="session-action-btn"
            onClick={(event) => {
              event.stopPropagation();
              onDeleteWorktree(session);
            }}
            disabled={deletingSessionId === session.id}
            title="Remove worktree"
            aria-label="Remove worktree"
          >
            <Trash2 size={13} strokeWidth={2} />
          </button>
        )}
      </div>
    </div>
  );
}
