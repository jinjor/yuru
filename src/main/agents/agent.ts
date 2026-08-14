import type { PlanUsageWindow, SessionProvider } from "../../shared/session.js";
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
  // Message typed into the PTY as the first user prompt once the session is
  // up. Used by providers without a launch-flag injection mechanism.
  initialInput?: string;
  // Message typed after initialInput. Kimi uses this for the requested task
  // because its worktree context already occupies the first user message.
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
// ここには「取れなかった」状態は現れない (呼び出し側が failed として扱う)。
export type PlanUsage =
  | {
      state: "ok";
      // その provider がその枠を持たないときは null。
      fiveHour: PlanUsageWindow | null;
      weekly: PlanUsageWindow | null;
    }
  | { state: "logged-out" }
  | { state: "no-plan-limits" };

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
  waitForSessionId(pending: PendingSession): Promise<string>;
  // Agent TUIs can keep repainting while requiring user action. This only
  // detects an agent-specific signal; false does not determine the overall
  // activity state.
  detectUserActionRequired?(terminalTitle: string): boolean;
  // Whether the agent recorded the injected initialInput into the session
  // store. Only providers that launch with initialInput implement this; the
  // runtime uses it to verify the injection did not get lost.
  hasRecordedInitialInput?(agentSessionId: string, initialInput: string): Promise<boolean>;
}
