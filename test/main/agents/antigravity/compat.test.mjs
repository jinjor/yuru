import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

// agy の内部仕様 — store の場所とスキーマ、CLI フラグ — に Yuru は依存している。
// 公開インターフェースではないのでアップデートで静かに変わりうるものを、実際の
// CLI と実 store に対するこのテストで検出する。agy や store が無い環境では skip する。

function agyAvailable() {
  try {
    execFileSync("agy", ["--version"], { stdio: "pipe", timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

const hasAgy = agyAvailable();
const skipNoAgy = { skip: !hasAgy };

const realAppDataDir =
  process.env.ANTIGRAVITY_APP_DATA_DIR || path.join(os.homedir(), ".gemini", "antigravity-cli");
const realDbPath = path.join(realAppDataDir, "conversation_summaries.db");
const hasDb = fs.existsSync(realDbPath);
const skipNoDb = { skip: !hasAgy || !hasDb };

function withRealDb(run) {
  const db = new DatabaseSync(realDbPath, { readOnly: true });
  try {
    return run(db);
  } finally {
    db.close();
  }
}

function columnsOf(db, table) {
  return new Set(
    db
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((row) => row.name),
  );
}

test("agy CLI は Yuru が起動と resume に使うフラグを持つ", skipNoAgy, () => {
  const result = spawnSync("agy", ["--help"], { encoding: "utf-8", timeout: 15_000 });
  assert.equal(result.error, undefined);
  const help = `${result.stdout ?? ""}${result.stderr ?? ""}`;

  assert.match(help, /--conversation/);
  assert.match(help, /--prompt-interactive/);
  assert.match(help, /--model/);
  assert.match(help, /--print/);
  assert.match(help, /--output-format/);
});

test("agy store は Yuru が読むテーブルとカラムを持つ", skipNoDb, () => {
  withRealDb((db) => {
    const columns = columnsOf(db, "conversation_summaries");
    for (const column of [
      "conversation_id",
      "workspace_uris",
      "title",
      "last_modified_time",
      "parent_conversation_id",
      "nesting_depth",
      "killed",
    ]) {
      assert.ok(columns.has(column), `conversation_summaries.${column} が無い`);
    }
  });
});

test("本番の session 一覧コードが実 store を読める", skipNoDb, async () => {
  const { agent: antigravityAgent } =
    await import("../../../../src/main/agents/antigravity/index.ts");

  const sessions = await antigravityAgent.loadStoredSessions();
  assert.ok(Array.isArray(sessions));
  for (const session of sessions) {
    assert.equal(typeof session.agentSessionId, "string");
    assert.equal(typeof session.project, "string");
  }
});
