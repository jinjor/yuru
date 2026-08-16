import { House, X } from "lucide-react";
import type { PrimarySessionListItem } from "../../shared/metadata";
import type { TerminalRuntimeId } from "../../shared/session";
import { SessionProviderDot } from "../providers/SessionProviderDot";
import { IconButton } from "../ui/IconButton";
import { Tab } from "../ui/Tab";

export interface TerminalTabsProps {
  activeTerminalRuntimeIds: readonly TerminalRuntimeId[];
  primarySessions: readonly PrimarySessionListItem[];
  selectedTerminalRuntimeId: TerminalRuntimeId | null;
  onSelectTerminalRuntime: (terminalRuntimeId: TerminalRuntimeId | null) => void;
  onKillTerminalRuntime: (terminalRuntimeId: TerminalRuntimeId) => void;
}

export function TerminalTabs({
  activeTerminalRuntimeIds,
  primarySessions,
  selectedTerminalRuntimeId,
  onSelectTerminalRuntime,
  onKillTerminalRuntime,
}: TerminalTabsProps) {
  const activeTerminalRuntimeIdSet = new Set(activeTerminalRuntimeIds);
  const primaryTerminalRuntimeIds = primarySessions.flatMap((session) => {
    const terminalRuntimeId = session.activeTerminalRuntimeId;
    return terminalRuntimeId && activeTerminalRuntimeIdSet.has(terminalRuntimeId)
      ? [terminalRuntimeId]
      : [];
  });
  const primaryTerminalRuntimeIdSet = new Set(primaryTerminalRuntimeIds);
  const orderedTerminalRuntimeIds = [
    ...primaryTerminalRuntimeIds,
    ...activeTerminalRuntimeIds.filter(
      (terminalRuntimeId) => !primaryTerminalRuntimeIdSet.has(terminalRuntimeId),
    ),
  ];

  return (
    <div className="session-tabs">
      <Tab
        className="session-tab session-tab-home"
        label="Home"
        selected={selectedTerminalRuntimeId === null}
        onSelect={() => onSelectTerminalRuntime(null)}
      >
        <House size={14} strokeWidth={2} aria-hidden="true" />
      </Tab>
      {orderedTerminalRuntimeIds.map((terminalRuntimeId) => {
        const session = primarySessions.find(
          (candidate) => candidate.activeTerminalRuntimeId === terminalRuntimeId,
        );
        const label = session?.preview || (session ? "(no messages)" : "Terminal");
        const selected = selectedTerminalRuntimeId === terminalRuntimeId;
        return (
          <Tab
            key={terminalRuntimeId}
            className="session-tab"
            label={label}
            selected={selected}
            onSelect={() => onSelectTerminalRuntime(terminalRuntimeId)}
            trailing={
              <IconButton
                className="session-tab-close"
                label={`Kill runtime: ${label}`}
                title="Kill runtime"
                size="sm"
                onClick={() => onKillTerminalRuntime(terminalRuntimeId)}
              >
                <X size={12} strokeWidth={2} aria-hidden="true" />
              </IconButton>
            }
          >
            {session && (
              <SessionProviderDot
                kind="primary"
                provider={session.provider}
                state={session.state}
                activityState={session.activityState}
              />
            )}
            <span className="session-tab-label">{label}</span>
          </Tab>
        );
      })}
    </div>
  );
}
