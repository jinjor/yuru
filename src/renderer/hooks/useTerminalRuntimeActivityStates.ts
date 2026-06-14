import { useEffect, useMemo, useState } from "react";
import type { RepoListItem } from "../../shared/metadata";
import type { AgentActivityState, TerminalRuntimeId } from "../../shared/session";

const ACTIVITY_POLL_INTERVAL_MS = 1000;
const TERMINAL_RUNTIME_ID_SEPARATOR = "\n";

export function useTerminalRuntimeActivityStates(
  repos: RepoListItem[],
): ReadonlyMap<TerminalRuntimeId, AgentActivityState> {
  const terminalRuntimeKey = useMemo(
    () => getActiveTerminalRuntimeIds(repos).join(TERMINAL_RUNTIME_ID_SEPARATOR),
    [repos],
  );
  const [activityStates, setActivityStates] = useState<
    ReadonlyMap<TerminalRuntimeId, AgentActivityState>
  >(() => new Map());

  useEffect(() => {
    if (terminalRuntimeKey === "") {
      setActivityStates((prev) => (prev.size === 0 ? prev : new Map()));
      return;
    }

    const terminalRuntimeIds = terminalRuntimeKey.split(TERMINAL_RUNTIME_ID_SEPARATOR);
    let stopped = false;
    let timeoutId: number | null = null;

    const pollActivityStates = async (): Promise<void> => {
      try {
        const nextActivityStates =
          await window.electronAPI.getTerminalRuntimeActivityStates(terminalRuntimeIds);
        if (!stopped) {
          const next = new Map(
            nextActivityStates.map((entry) => [entry.terminalRuntimeId, entry.activityState]),
          );
          setActivityStates((prev) => (sameActivityStates(prev, next) ? prev : next));
        }
      } catch (error) {
        console.error("Failed to load terminal runtime activity states.", error);
      }
      if (!stopped) {
        timeoutId = window.setTimeout(pollActivityStates, ACTIVITY_POLL_INTERVAL_MS);
      }
    };

    void pollActivityStates();

    return () => {
      stopped = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [terminalRuntimeKey]);

  return activityStates;
}

function getActiveTerminalRuntimeIds(repos: RepoListItem[]): TerminalRuntimeId[] {
  const terminalRuntimeIds = new Set<TerminalRuntimeId>();
  for (const repo of repos) {
    for (const worktree of repo.taskWorktrees) {
      const primaryTerminalRuntimeId = worktree.primarySession?.activeTerminalRuntimeId;
      if (primaryTerminalRuntimeId) {
        terminalRuntimeIds.add(primaryTerminalRuntimeId);
      }
      for (const suggestedSession of worktree.suggestedSessions) {
        if (suggestedSession.activeTerminalRuntimeId) {
          terminalRuntimeIds.add(suggestedSession.activeTerminalRuntimeId);
        }
      }
    }
  }
  return Array.from(terminalRuntimeIds);
}

function sameActivityStates(
  a: ReadonlyMap<TerminalRuntimeId, AgentActivityState>,
  b: ReadonlyMap<TerminalRuntimeId, AgentActivityState>,
): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const [terminalRuntimeId, activityState] of a) {
    if (b.get(terminalRuntimeId) !== activityState) {
      return false;
    }
  }
  return true;
}
