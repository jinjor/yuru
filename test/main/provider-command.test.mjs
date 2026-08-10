import assert from "node:assert/strict";
import test from "node:test";

import { resolveCommandPaths } from "../../src/main/provider-command.ts";

// ログインシェルの代わりに、渡されたスクリプトをそのまま実行する sh を使う。
// -i -l を付けても sh は素直に -c のスクリプトを実行する。
const shellEnv = { SHELL: "/bin/sh" };

test("見つかった command だけを、ログインシェルの PATH つきで返す", async () => {
  const resolved = await resolveCommandPaths(["sh", "definitely-not-a-command"], shellEnv);

  assert.deepEqual([...resolved.keys()], ["sh"]);
  assert.ok(resolved.get("sh").path.endsWith("/sh"));
  assert.equal(resolved.get("sh").pathEnv.length > 0, true);
});

test("1 つも見つからなくても成功として空を返す", async () => {
  const resolved = await resolveCommandPaths(["definitely-not-a-command"], shellEnv);

  assert.equal(resolved.size, 0);
});

test("シェルが即座に終わったときは失敗にする (未インストール扱いにしない)", async () => {
  // スクリプトを実行せずに終わるシェル。出力が空になる点は「1 つも見つからなかった」
  // 場合と同じなので、目印の行が出ていないことで区別できている必要がある。
  await assert.rejects(
    () => resolveCommandPaths(["sh"], { SHELL: "/usr/bin/false" }),
    /login shell exited before resolving/,
  );
});

test("シェルが存在しないときも失敗にする", async () => {
  await assert.rejects(() => resolveCommandPaths(["sh"], { SHELL: "/nonexistent/shell" }), /ENOENT/);
});
