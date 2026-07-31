import type { SessionProvider } from "../shared/session.js";

export interface TerminalEnvOptions {
  apiSocketPath: string;
  yuruCliPath: string;
  provider?: SessionProvider;
  worktreePath?: string;
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

  if (options.provider === "codex") {
    for (const key of Object.keys(env)) {
      if (/^CODEX_.*(THREAD|SESSION|CONVERSATION).*/.test(key)) {
        delete env[key];
      }
    }
  }

  env.YURU_API_SOCKET = options.apiSocketPath;
  env.YURU_CLI = options.yuruCliPath;
  if (options.worktreePath) {
    env.YURU_WORKTREE_PATH = options.worktreePath;
  } else {
    delete env.YURU_WORKTREE_PATH;
  }

  return env;
}
