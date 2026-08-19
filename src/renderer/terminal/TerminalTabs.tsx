import { useRef } from "react";
import { House, X } from "lucide-react";
import type { PrimarySessionListItem } from "../../shared/metadata";
import type { TerminalRuntimeId } from "../../shared/session";
import { SessionProviderDot } from "../providers/SessionProviderDot";
import { IconButton } from "../ui/IconButton";
import { Tab } from "../ui/Tab";
import { useReorderDrag } from "../utils/useReorderDrag";
import { toPrimarySessionOrder } from "./primarySessionOrder";

export interface TerminalTabsProps {
  activeTerminalRuntimeIds: readonly TerminalRuntimeId[];
  primarySessions: readonly PrimarySessionListItem[];
  selectedTerminalRuntimeId: TerminalRuntimeId | null;
  onSelectTerminalRuntime: (terminalRuntimeId: TerminalRuntimeId | null) => void;
  onKillTerminalRuntime: (terminalRuntimeId: TerminalRuntimeId) => void;
  // タブの並び替え。渡すのはホームと同じ、この worktree の全 primary session の key。
  onReorderPrimarySessions: (agentSessionKeys: string[]) => void;
}

export function TerminalTabs({
  activeTerminalRuntimeIds,
  primarySessions,
  selectedTerminalRuntimeId,
  onSelectTerminalRuntime,
  onKillTerminalRuntime,
  onReorderPrimarySessions,
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

  const tabsRef = useRef<HTMLDivElement>(null);
  // 並び替えの ID はホームと同じ agentSessionKey。掴めるのは primary session のタブだけで、
  // Home タブと primary でない runtime のタブは掴めず、落とす先にもならない。
  const tabKeys = primarySessions.flatMap((session) =>
    session.agentSessionKey !== null &&
    session.activeTerminalRuntimeId !== null &&
    activeTerminalRuntimeIdSet.has(session.activeTerminalRuntimeId)
      ? [session.agentSessionKey]
      : [],
  );
  const tabReorder = useReorderDrag({
    itemIds: tabKeys,
    containerRef: tabsRef,
    axis: "horizontal",
    onReorder: (nextTabKeys, movedKey) => {
      const primarySessionKeys = primarySessions.flatMap((session) =>
        session.agentSessionKey === null ? [] : [session.agentSessionKey],
      );
      onReorderPrimarySessions(toPrimarySessionOrder(primarySessionKeys, nextTabKeys, movedKey));
    },
  });

  return (
    <div className="session-tabs" ref={tabsRef}>
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
        const agentSessionKey = session?.agentSessionKey;
        return (
          <Tab
            key={terminalRuntimeId}
            className="session-tab"
            label={label}
            reorder={agentSessionKey ? { itemId: agentSessionKey, drag: tabReorder } : undefined}
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
