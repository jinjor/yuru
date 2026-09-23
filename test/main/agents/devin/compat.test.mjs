import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

// devin の内部仕様 — store の場所とスキーマ、chat_message の JSON 形、CLI フラグ —
// に Yuru は依存している。公開インターフェースではないのでアップデートで静かに
// 変わりうるものを、実際の CLI と実 store に対するこのテストで検出する。
// devin も store も無い環境では skip する (CI など)。
// AI_AGENT マーカーの形式や実セッションの記録はログイン済みの起動が要るので
// ここではカバーしない (e2e 側の領分)。

function devinAvailable() {
  try {
    execFileSync("devin", ["version"], { stdio: "pipe", timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

const hasDevin = devinAvailable();
const skipNoDevin = { skip: !hasDevin };

const realDbPath =
  process.env.CHISEL_SESSION_DB ??
  path.join(os.homedir(), ".local", "share", "devin", "cli", "sessions.db");
const hasDb = fs.existsSync(realDbPath);
const skipNoDb = { skip: !hasDevin || !hasDb };

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

test("devin CLI は Yuru が起動と resume に使うフラグを持つ", skipNoDevin, () => {
  const help = execFileSync("devin", ["--help"], { encoding: "utf-8", timeout: 15_000 });

  assert.match(help, /--resume/);
  assert.match(help, /--model/);
});

test("devin auth status はログイン状態を exit 0 の文字列として返す", skipNoDevin, () => {
  const output = execFileSync("devin", ["auth", "status"], {
    encoding: "utf-8",
    timeout: 30_000,
  });

  assert.match(output, /logged in|not logged in/i);
});

test("devin store は Yuru が読むテーブルとカラムを持つ", skipNoDb, () => {
  withRealDb((db) => {
    const sessions = columnsOf(db, "sessions");
    for (const column of ["id", "working_directory", "created_at", "last_activity_at"]) {
      assert.ok(sessions.has(column), `sessions.${column} が無い`);
    }
    const nodes = columnsOf(db, "message_nodes");
    for (const column of ["session_id", "node_id", "chat_message", "created_at"]) {
      assert.ok(nodes.has(column), `message_nodes.${column} が無い`);
    }
  });
});

test("記録された chat_message は本番の parseMessage で読める形をしている", skipNoDb, async () => {
  const { parseMessage } = await import("../../../../src/main/agents/devin/store.ts");

  withRealDb((db) => {
    const rows = db
      .prepare(`SELECT chat_message FROM message_nodes ORDER BY row_id DESC LIMIT 50`)
      .all();
    if (rows.length === 0) {
      return;
    }
    assert.ok(
      rows.some((row) => parseMessage(JSON.parse(row.chat_message)) !== null),
      "直近の chat_message がどれも { role, content } として parse できない",
    );
  });
});

test("本番の session 一覧コードが実 store を読める", skipNoDb, async () => {
  const { agent: devinAgent } = await import("../../../../src/main/agents/devin/index.ts");

  const sessions = await devinAgent.loadStoredSessions();
  assert.ok(Array.isArray(sessions));
  for (const session of sessions) {
    assert.equal(typeof session.agentSessionId, "string");
    assert.equal(typeof session.project, "string");
  }
});
