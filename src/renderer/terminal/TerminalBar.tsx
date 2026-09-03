import { GitBranch } from "lucide-react";
import type { GitHubPullRequest } from "../../shared/session";
import { GitHubBadge } from "../pull-requests/GitHubBadge";
import { TerminalTabs, type TerminalTabsProps } from "./TerminalTabs";

interface TerminalBarProps extends TerminalTabsProps {
  currentBranch: string | null;
  currentGitHub: GitHubPullRequest | null;
  worktreeId: string;
}

export function TerminalBar({
  activeTerminalRuntimeIds,
  currentBranch,
  currentGitHub,
  onKillTerminalRuntime,
  onReorderPrimarySessions,
  onSelectTerminalRuntime,
  primarySessions,
  selectedTerminalRuntimeId,
  worktreeId,
}: TerminalBarProps) {
  return (
    <div className="panel-header terminal-bar">
      <TerminalTabs
        activeTerminalRuntimeIds={activeTerminalRuntimeIds}
        primarySessions={primarySessions}
        selectedTerminalRuntimeId={selectedTerminalRuntimeId}
        onSelectTerminalRuntime={onSelectTerminalRuntime}
        onKillTerminalRuntime={onKillTerminalRuntime}
        onReorderPrimarySessions={onReorderPrimarySessions}
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
              void window.electronAPI.addBookmark(worktreeId, currentGitHub.url).catch((error) => {
                console.error("Failed to bookmark pull request URL.", error);
              });
              void window.electronAPI.openExternal(currentGitHub.url).catch((error) => {
                console.error("Failed to open pull request URL.", error);
              });
            }}
          />
        )}
      </div>
    </div>
  );
}
