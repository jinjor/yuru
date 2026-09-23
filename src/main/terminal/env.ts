import type { SessionProvider } from "../../shared/session.js";

export interface TerminalEnvOptions {
  apiSocketPath: string;
  repoPath: string;
  yuruCliPath: string;
  provider?: SessionProvider;
  worktreePath: string;
}

export function createTerminalEnv(
  baseEnv: Record<string, string | undefined>,
  options: TerminalEnvOptions,
): Record<string, string> {
  const env = Object.fromEntries(
    Object.entries(baseEnv).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );

  // The embedded terminal is color-capable even if the parent shell opted out.
  delete env.NO_COLOR;
  env.TERM = "xterm-256color";
  env.COLORTERM ??= "truecolor";

  // Yuru always launches a fresh top-level agent session. When Yuru itself is
  // started from inside a Claude Code session, these markers leak in through the
  // inherited environment, and a freshly launched `claude` then treats itself as
  // a nested child session and never registers its session — so session
  // detection times out. CLAUDE_CODE_SSE_PORT points at the parent's IDE
  // integration, which makes the new session open a blocking notice that
  // swallows the first typed characters. Drop them so every launch is a clean
  // top-level session.
  for (const key of [
    "CLAUDECODE",
    "CLAUDE_CODE_CHILD_SESSION",
    "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDE_CODE_SESSION_ID",
    "CLAUDE_CODE_EXECPATH",
    "CLAUDE_CODE_SSE_PORT",
  ]) {
    delete env[key];
  }

  // AI_AGENT is a generic marker any hosting agent CLI sets for its child
  // processes (devin_3000-11-1_agent, claude-code_...). A fresh top-level
  // session must not inherit the parent agent's marker.
  delete env.AI_AGENT;

  if (options.provider === "codex") {
    for (const key of Object.keys(env)) {
      if (/^CODEX_.*(THREAD|SESSION|CONVERSATION).*/.test(key)) {
        delete env[key];
      }
    }
  }

  if (options.provider === "devin") {
    // Yuru always launches devin as a fresh top-level session. When Yuru itself
    // runs inside a devin session's terminal, the parent's permission mode and
    // sandbox settings would leak into the child — e.g. a devin that approves
    // every action without asking. CHISEL_SESSION_DB stays so the store the
    // child writes is the same one Yuru reads for session detection.
    for (const key of ["DEVIN_MODEL", "DEVIN_PERMISSION_MODE", "DEVIN_SANDBOX"]) {
      delete env[key];
    }
  }

  env.YURU_API_SOCKET = options.apiSocketPath;
  env.YURU_CLI = options.yuruCliPath;
  env.YURU_REPO_PATH = options.repoPath;
  env.YURU_WORKTREE_PATH = options.worktreePath;

  return env;
}
