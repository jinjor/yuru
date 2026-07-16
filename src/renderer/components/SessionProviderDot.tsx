import type { WorktreeSessionState } from "../../shared/metadata";
import type { AgentActivityState, SessionProvider } from "../../shared/session";
import { providerLabel } from "../utils/session";

interface SessionProviderDotProps {
  kind: "primary" | "suggested";
  provider: SessionProvider;
  state: WorktreeSessionState;
  activityState: AgentActivityState;
}

export function SessionProviderDot({
  kind,
  provider,
  state,
  activityState,
}: SessionProviderDotProps) {
  const activityClass = state === "active" ? `activity-${activityState}` : "";
  const stateLabel = state === "active" ? `${state} · ${activityState}` : state;
  const providerName = providerLabel(provider);
  const kindLabel = kind === "suggested" ? "suggested session" : "primary session";
  const title =
    kind === "suggested"
      ? `${providerName} · suggested · ${stateLabel}`
      : `${providerName} · ${stateLabel}`;

  return (
    <span
      className={[
        "session-provider-dot",
        `provider-${provider}`,
        kind === "suggested" ? "suggested" : "",
        state,
        activityClass,
      ]
        .filter(Boolean)
        .join(" ")}
      title={title}
      aria-label={`${providerName} ${kindLabel} ${stateLabel}`}
    />
  );
}
