import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { APP_NAME, buildWindowTitle } from "../../src/main/app-title.ts";

test("buildWindowTitle は main worktree ではアプリ名だけを返す", () => {
  assert.equal(
    buildWindowTitle({
      appPath: "/repo/yuru",
      mainWorktreePath: "/repo/yuru",
      branch: "main",
    }),
    APP_NAME,
  );
});

test("buildWindowTitle は linked worktree の branch をタイトルに含める", () => {
  assert.equal(
    buildWindowTitle({
      appPath: "/repo/yuru/.yuru/worktrees/task-a",
      mainWorktreePath: "/repo/yuru",
      branch: "task-a",
    }),
    `${APP_NAME} - worktree: task-a`,
  );
});

test("buildWindowTitle は detached worktree では directory name をタイトルに含める", () => {
  assert.equal(
    buildWindowTitle({
      appPath: path.join("/repo/yuru/.yuru/worktrees", "detached-task"),
      mainWorktreePath: "/repo/yuru",
      branch: null,
    }),
    `${APP_NAME} - worktree: detached-task`,
  );
});

test("buildWindowTitle は Git repo ではない起動元ではアプリ名だけを返す", () => {
  assert.equal(
    buildWindowTitle({
      appPath: "/Applications/Yuru.app/Contents/Resources/app.asar",
      mainWorktreePath: null,
      branch: null,
    }),
    APP_NAME,
  );
});
