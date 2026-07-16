import { GitBranch } from "lucide-react";
import type { GitHubPullRequest } from "../../shared/session";
import { GitHubBadge } from "./GitHubBadge";

interface TerminalBarProps {
  currentBranch: string | null;
  currentGitHub: GitHubPullRequest | null;
  onOpenExternal: (url: string) => void;
}

export function TerminalBar({ currentBranch, currentGitHub, onOpenExternal }: TerminalBarProps) {
  return (
    <div className="panel-header terminal-bar">
      <h2>Terminal</h2>
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
