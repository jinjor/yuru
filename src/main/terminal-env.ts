import type { SessionProvider } from "../shared/session.js";

export function createTerminalEnv(
  baseEnv: Record<string, string | undefined>,
  provider?: SessionProvider,
): Record<string, string> {
  const env = Object.fromEntries(
    Object.entries(baseEnv).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );

  // The embedded terminal is color-capable even if the parent shell opted out.
  delete env.NO_COLOR;
  env.TERM = "xterm-256color";
  env.COLORTERM ??= "truecolor";

  if (provider === "codex") {
    for (const key of Object.keys(env)) {
      if (/^CODEX_.*(THREAD|SESSION|CONVERSATION).*/.test(key)) {
        delete env[key];
      }
    }
  }

  return env;
}
