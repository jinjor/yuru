export const SESSION_PROVIDER_IDS = ["claude", "codex", "kimi"] as const;
export type SessionProvider = (typeof SESSION_PROVIDER_IDS)[number];
export type TerminalRuntimeId = string;
export type AgentActivityState = "working" | "waiting";

export interface SuggestedWorktreeSession {
  provider: SessionProvider;
  agentSessionId: string;
  // Directory the session was created in (where the agent stores it). Carried
  // so promoting the session can record where to resume it.
  cwd: string;
  timestamp: number;
}

export interface GitHubPullRequest {
  prNumber: number;
  state: "open" | "draft" | "merged" | "closed";
  isApproved: boolean;
  url: string;
}

// プランのリミット 1 枠ぶんの使用状況。セッションが消費したトークン量ではなく、
// provider 自身が「この枠を何 % 使ったか」として返してくる値。
export interface PlanUsageWindow {
  usedPercent: number;
  // 枠がリセットされる時刻 (epoch ms)。provider が返さないときだけ null。
  resetsAt: number | null;
}

// provider ごとのプラン利用状況。インストールされていない provider は
// そもそもこの値を持たない (一覧に現れない) ので、ここには状態として現れない。
export type ProviderPlanUsage = { provider: SessionProvider } & (
  | {
      state: "ok";
      // その provider がその枠を持たないときは null。Codex の 5 時間枠がこれ。
      fiveHour: PlanUsageWindow | null;
      weekly: PlanUsageWindow | null;
      fetchedAt: number;
    }
  // その CLI にログインしていない。
  | { state: "logged-out" }
  // ログインはしているがプランのリミットが適用されない。
  // Claude を ANTHROPIC_API_KEY や Bedrock / Vertex で使っているときにこうなる。
  | { state: "no-plan-limits" }
  // 上記以外の理由で取得できなかった。詳細は error center に記録される。
  | { state: "failed" }
);

export function toSessionKey(provider: SessionProvider, agentSessionId: string): string {
  return `${provider}:${agentSessionId}`;
}

// rate limit で断られた所で止まっている session。解除されるまでの間だけ存在し、
// 端末の上部にその表示と「解除されたら続きを実行する」指定を出す。
export interface RateLimitStop {
  terminalRuntimeId: TerminalRuntimeId;
  provider: SessionProvider;
  // 使い切っている枠が最後にリセットされる時刻 (epoch ms)。
  // provider がリセット時刻を返さない場合だけ null。
  resetsAt: number | null;
  continueWhenReset: boolean;
}
