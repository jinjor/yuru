import { House, X } from "lucide-react";
import type { PrimarySessionListItem } from "../../shared/metadata";
import type { TerminalRuntimeId } from "../../shared/session";
import { SessionProviderDot } from "./SessionProviderDot";

export interface SessionTabsProps {
  activeTerminalRuntimeIds: readonly TerminalRuntimeId[];
  primarySessions: readonly PrimarySessionListItem[];
  selectedTerminalRuntimeId: TerminalRuntimeId | null;
  onSelectTerminalRuntime: (terminalRuntimeId: TerminalRuntimeId | null) => void;
  onKillTerminalRuntime: (terminalRuntimeId: TerminalRuntimeId) => void;
}

export function SessionTabs({
  activeTerminalRuntimeIds,
  primarySessions,
  selectedTerminalRuntimeId,
  onSelectTerminalRuntime,
  onKillTerminalRuntime,
}: SessionTabsProps) {
  return (
    <div className="session-tabs" role="tablist" aria-label="Terminal sessions">
      <button
        type="button"
        className={`session-tab session-tab-home ${selectedTerminalRuntimeId === null ? "active" : ""}`}
        role="tab"
        aria-label="Home"
        aria-selected={selectedTerminalRuntimeId === null}
        title="Home"
        onClick={() => onSelectTerminalRuntime(null)}
      >
        <House size={14} strokeWidth={2} aria-hidden="true" />
      </button>
      {activeTerminalRuntimeIds.map((terminalRuntimeId) => {
        const session = primarySessions.find(
          (candidate) => candidate.activeTerminalRuntimeId === terminalRuntimeId,
        );
        const label = session?.preview || (session ? "(no messages)" : "Terminal");
        const selected = selectedTerminalRuntimeId === terminalRuntimeId;
        return (
          <div
            key={terminalRuntimeId}
            className={`session-tab ${selected ? "active" : ""}`}
            role="tab"
            tabIndex={0}
            aria-selected={selected}
            title={label}
            onClick={() => onSelectTerminalRuntime(terminalRuntimeId)}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) {
                return;
              }
              if (event.key !== "Enter" && event.key !== " ") {
                return;
              }
              event.preventDefault();
              onSelectTerminalRuntime(terminalRuntimeId);
            }}
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
            <button
              type="button"
              className="session-tab-close"
              title="Kill runtime"
              aria-label={`Kill runtime: ${label}`}
              onClick={(event) => {
                event.stopPropagation();
                onKillTerminalRuntime(terminalRuntimeId);
              }}
            >
              <X size={12} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
