import { spawn } from "child_process";
import os from "os";

const RESOLVE_TIMEOUT_MS = 10_000;

// Yuru は provider をユーザーのログインシェル経由で起動する (shell-launch.ts) ため、
// その CLI がどこにあるかはログインシェルの PATH で決まる。Electron 自身の PATH で
// 探すと答えが違う (Finder から起動した Electron の PATH は最小限で、実際の CLI は
// ~/.local/bin や nvm 配下や Homebrew 配下にある)。
//
// ログインシェルの起動は 1 回 0.5 秒ほどかかるので、provider ごとに聞かず
// 1 プロセスでまとめて解決する。見つかった command だけが結果に入るので、
// 「入っていない provider をどこにも出さない」の判定もこれで行う。
export async function resolveCommandPaths(
  commands: readonly string[],
  baseEnv: Record<string, string | undefined> = process.env,
): Promise<Map<string, string>> {
  const output = await runLoginShell(buildResolveScript(commands), baseEnv);
  const paths = new Map<string, string>();
  for (const line of output.split("\n")) {
    const separator = line.indexOf("\t");
    if (separator === -1) {
      continue;
    }
    const command = line.slice(0, separator);
    const commandPath = line.slice(separator + 1).trim();
    // command -v は alias や shell 関数にも当たり、その場合はパスではなく定義を返す。
    // Yuru はパスを直接起動するので、絶対パスで返ったものだけを「見つかった」とする。
    if (commands.includes(command) && commandPath.startsWith("/")) {
      paths.set(command, commandPath);
    }
  }
  return paths;
}

function buildResolveScript(commands: readonly string[]): string {
  const list = commands.map((command) => `'${command.replace(/'/g, "'\\''")}'`).join(" ");
  return `for c in ${list}; do p=$(command -v "$c") && printf '%s\\t%s\\n' "$c" "$p"; done`;
}

function runLoginShell(
  script: string,
  baseEnv: Record<string, string | undefined>,
): Promise<string> {
  const shell = baseEnv.SHELL || os.userInfo().shell || "sh";
  return new Promise((resolve, reject) => {
    // ログインシェルにするのは、ユーザーの PATH 設定が rc / profile にあるため。
    // 起動と同じ条件で解決しないと、起動できる CLI を見落とす。
    const child = spawn(shell, ["-i", "-l", "-c", script], { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${shell} did not respond within ${RESOLVE_TIMEOUT_MS}ms`));
    }, RESOLVE_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    // command -v が 1 つも当たらないとシェル自体も非 0 で終わるため、終了コードは
    // 失敗として扱わない。出力が空なら「どれも見つからなかった」になる。
    child.on("close", () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString("utf-8"));
    });
  });
}
