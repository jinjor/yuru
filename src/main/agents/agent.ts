import type { AgentActivityState, PlanUsageWindow, SessionProvider } from "../../shared/session.js";
import type { AgentDefinition } from "../../shared/agent.js";
import type { PendingTerminal } from "../terminal/runtime.js";
import type { ResolvedAgentCommand } from "./command.js";
import type { WorktreeSessionHint } from "./session-detection.js";

export interface SessionSnapshot {
  provider: SessionProvider;
  agentSessionId: string;
  project: string;
  lastMessage: string;
  timestamp: number;
}

export interface SessionPreview {
  lastMessage: string;
  timestamp: number;
}

export interface PendingSession extends PendingTerminal {
  provider: SessionProvider;
  agentSessionId: string | null;
  existingAgentSessionIds: ReadonlySet<string>;
  initialInput: string | null;
  initialPrompt: string | null;
}

export interface LaunchRequest {
  cwd: string;
  args: string[];
  worktreePath: string;
  existingAgentSessionIds?: ReadonlySet<string>;
  // Startup context delivered by the provider during waitForSessionId.
  initialInput?: string;
  // Requested task typed by the runtime after provider initialization.
  initialPrompt?: string;
}

export interface WorktreeContext {
  repoPath: string;
  worktreePath: string;
  worktreeName: string;
  branchName: string;
  initialPrompt?: string;
  model?: string;
}

export interface ResumeSessionTarget {
  provider: SessionProvider;
  agentSessionId: string;
  // Directory to launch the resume in (where the agent stored the session).
  cwd: string;
  project: string;
}

// provider が返したプランの利用状況。取得そのものに失敗した場合は例外になるので、
// ここに現れる「取れなかった」状態は unavailable だけ (呼び出し側は例外を failed
// として扱う)。unavailable はエラーではなく、その provider に読むべきデータが
// そもそも無いことを表す。
export type PlanUsage =
  | {
      state: "ok";
      // その provider がその枠を持たないときは null。
      fiveHour: PlanUsageWindow | null;
      weekly: PlanUsageWindow | null;
    }
  | { state: "logged-out" }
  | { state: "no-plan-limits" }
  | { state: "unavailable" };

export interface Agent {
  definition: AgentDefinition;
  command: string;
  resolvesSessionIdLazily: boolean;
  loadStoredSessions(): Promise<SessionSnapshot[]>;
  loadStoredSessionPreview(agentSessionId: string): Promise<SessionPreview | null>;
  loadWorktreeSessionHints(worktreePaths: readonly string[]): Promise<WorktreeSessionHint[]>;
  hasStoredSession(agentSessionId: string): Promise<boolean>;
  // command はログインシェルで解決した CLI の絶対パスと PATH。Yuru は認証情報を
  // 自分では扱わず、CLI に自分のログインを使わせる。
  loadPlanUsage(command: ResolvedAgentCommand): Promise<PlanUsage>;
  createResumeLaunch(session: ResumeSessionTarget): Promise<LaunchRequest>;
  createWorktreeLaunch(context: WorktreeContext): Promise<LaunchRequest>;
  // Complete provider-specific initialization, including initialInput delivery,
  // and return the session ID. The runtime owns registration and monitoring.
  waitForSessionId(pending: PendingSession): Promise<string>;
  // Prefer the agent's explicit state over terminal output, which can include
  // idle animations. null means the title does not expose a recognized state.
  detectActivityState?(terminalTitle: string): AgentActivityState | null;
  // Whether the session is stopped where the provider refused a request for
  // rate limiting. Reads the agent's own record of the refusal; agents that do
  // not record one leave this out and never auto-continue.
  isStoppedByRateLimit?(agentSessionId: string): Promise<boolean>;
  // Whether the agent recorded a terminal-submitted message into its session
  // store. The runtime uses this to verify delivery of initialPrompt.
  hasRecordedInitialInput?(agentSessionId: string, initialInput: string): Promise<boolean>;
}
