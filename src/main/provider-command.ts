import { spawn } from "child_process";
import os from "os";

const RESOLVE_TIMEOUT_MS = 10_000;
// 解決スクリプトが最後まで走ったことを示す目印。1 つも見つからなかった正常な場合と、
// シェルが起動できずに何も出力しなかった場合を、出力の空さだけでは区別できないため。
const SENTINEL = "yuru-resolved";

export interface ResolvedProviderCommand {
  // ログインシェルで解決した CLI の絶対パス。
  path: string;
  // ログインシェルの PATH。実行ファイルが絶対パスでも、shebang のインタプリタは
  // PATH から探される (codex は `#!/usr/bin/env node`)。これを渡さないと、
  // Finder から起動した Yuru では最小の PATH を継承して起動に失敗する。
  pathEnv: string;
}

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
): Promise<Map<string, ResolvedProviderCommand>> {
  const lines = (await runLoginShell(buildResolveScript(commands), baseEnv))
    .split("\n")
    .map((line) => line.trimEnd());
  if (!lines.includes(SENTINEL)) {
    throw new Error("login shell exited before resolving provider commands");
  }

  const pathEnv = lines
    .map((line) => line.split("\t"))
    .find((fields) => fields[0] === "env" && fields[1] === "PATH")?.[2];
  if (pathEnv === undefined) {
    throw new Error("login shell did not report PATH");
  }

  const resolved = new Map<string, ResolvedProviderCommand>();
  for (const line of lines) {
    const [kind, name, value] = line.split("\t");
    // command -v は alias や shell 関数にも当たり、その場合はパスではなく定義を返す。
    // Yuru はパスを直接起動するので、絶対パスで返ったものだけを「見つかった」とする。
    if (kind === "cmd" && commands.includes(name) && value?.startsWith("/")) {
      resolved.set(name, { path: value, pathEnv });
    }
  }
  return resolved;
}

function buildResolveScript(commands: readonly string[]): string {
  const list = commands.map((command) => `'${command.replace(/'/g, "'\\''")}'`).join(" ");
  return [
    `printf 'env\\tPATH\\t%s\\n' "$PATH"`,
    `for c in ${list}; do p=$(command -v "$c") && printf 'cmd\\t%s\\t%s\\n' "$c" "$p"; done`,
    `printf '${SENTINEL}\\n'`,
  ].join("; ");
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
    // 見ない。スクリプトが最後まで走ったかどうかは目印の行で判定する。
    child.on("close", () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString("utf-8"));
    });
  });
}
