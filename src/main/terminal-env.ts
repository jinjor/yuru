export function createTerminalEnv(
  baseEnv: Record<string, string | undefined>,
): Record<string, string> {
  const env = Object.fromEntries(
    Object.entries(baseEnv).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );

  // The embedded terminal is color-capable even if the parent shell opted out.
  delete env.NO_COLOR;
  env.TERM = "xterm-256color";
  env.COLORTERM ??= "truecolor";

  return env;
}
