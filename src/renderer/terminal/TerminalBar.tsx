import { GitBranch } from "lucide-react";
import type { GitHubPullRequest } from "../../shared/session";
import { GitHubBadge } from "../shared/GitHubBadge";
import { SessionTabs, type SessionTabsProps } from "./SessionTabs";

interface TerminalBarProps extends SessionTabsProps {
  currentBranch: string | null;
  currentGitHub: GitHubPullRequest | null;
  onOpenExternal: (url: string) => void;
}

export function TerminalBar({
  activeTerminalRuntimeIds,
  currentBranch,
  currentGitHub,
  onKillTerminalRuntime,
  onOpenExternal,
  onSelectTerminalRuntime,
  primarySessions,
  selectedTerminalRuntimeId,
}: TerminalBarProps) {
  return (
    <div className="panel-header terminal-bar">
      <SessionTabs
        activeTerminalRuntimeIds={activeTerminalRuntimeIds}
        primarySessions={primarySessions}
        selectedTerminalRuntimeId={selectedTerminalRuntimeId}
        onSelectTerminalRuntime={onSelectTerminalRuntime}
        onKillTerminalRuntime={onKillTerminalRuntime}
      />
      <div className="terminal-bar-meta">
        {currentBranch && (
          <span className="terminal-bar-branch">
            <GitBranch size={11} strokeWidth={2} />
            {currentBranch}
          </span>
        )}
        {currentGitHub && (
          <GitHubBadge
            github={currentGitHub}
            onClick={() => {
              onOpenExternal(currentGitHub.url);
            }}
          />
        )}
      </div>
    </div>
  );
}
