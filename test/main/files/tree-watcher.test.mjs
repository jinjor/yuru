import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { FileTreeWatcher } from "../../../src/main/files/tree-watcher.ts";

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "yuru-tree-watcher-"));
}

function createRecordingWatcher(t) {
  const changes = [];
  const watcher = new FileTreeWatcher((rootPath, relativePath) => {
    changes.push({ rootPath, relativePath });
  });
  t.after(() => watcher.stop());
  return { changes, watcher };
}

function hasChange(changes, rootPath, relativePath) {
  return changes.some(
    (change) => change.rootPath === rootPath && change.relativePath === relativePath,
  );
}

// 監視を始めた直後の変更は OS が取りこぼすことがあるので、通知が来るまで directory に
// ファイルを書き足し続ける。
async function writeUntilNotified(changes, rootPath, relativePath, directory) {
  const deadline = Date.now() + 5000;
  let count = 0;
  while (!hasChange(changes, rootPath, relativePath)) {
    if (Date.now() > deadline) {
      assert.fail(`${rootPath}:${relativePath} was not notified: ${JSON.stringify(changes)}`);
    }
    fs.writeFileSync(path.join(directory, `change-${count}.txt`), "x");
    count += 1;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

// 通知の間引き (120ms) より十分に長く待って、来ないことを確かめる。
function waitPastDebounce() {
  return new Promise((resolve) => setTimeout(resolve, 500));
}

test("FileTreeWatcher は変更を、ルートとそこからの相対パスで知らせる", async (t) => {
  const root = makeTempDir();
  fs.mkdirSync(path.join(root, "sub"));
  const { changes, watcher } = createRecordingWatcher(t);

  watcher.sync(root, ["", "sub"]);

  await writeUntilNotified(changes, root, "sub", path.join(root, "sub"));
  await writeUntilNotified(changes, root, "", root);
});

test("FileTreeWatcher は同期で外したディレクトリの変更を知らせない", async (t) => {
  const root = makeTempDir();
  fs.mkdirSync(path.join(root, "sub"));
  const { changes, watcher } = createRecordingWatcher(t);

  watcher.sync(root, ["", "sub"]);
  watcher.sync(root, [""]);
  fs.writeFileSync(path.join(root, "sub", "x.txt"), "x");

  await waitPastDebounce();
  assert.ok(!hasChange(changes, root, "sub"), JSON.stringify(changes));
});

test("FileTreeWatcher はルートごとに監視し、別のルートの同期ではやめない", async (t) => {
  const firstRoot = makeTempDir();
  const secondRoot = makeTempDir();
  const { changes, watcher } = createRecordingWatcher(t);

  watcher.sync(firstRoot, [""]);
  watcher.sync(secondRoot, [""]);

  await writeUntilNotified(changes, firstRoot, "", firstRoot);
  await writeUntilNotified(changes, secondRoot, "", secondRoot);
});

test("FileTreeWatcher は空で同期すると、そのルートの監視だけをやめる", async (t) => {
  const stoppedRoot = makeTempDir();
  const watchedRoot = makeTempDir();
  const { changes, watcher } = createRecordingWatcher(t);

  watcher.sync(stoppedRoot, [""]);
  watcher.sync(watchedRoot, [""]);
  await writeUntilNotified(changes, stoppedRoot, "", stoppedRoot);

  watcher.sync(stoppedRoot, []);
  await waitPastDebounce();
  changes.length = 0;
  fs.writeFileSync(path.join(stoppedRoot, "after-stop.txt"), "x");

  await writeUntilNotified(changes, watchedRoot, "", watchedRoot);
  await waitPastDebounce();
  assert.ok(!changes.some((change) => change.rootPath === stoppedRoot), JSON.stringify(changes));
});

test("FileTreeWatcher はルートを消すとき、そのルートを監視していれば止める", async (t) => {
  const root = makeTempDir();
  const { changes, watcher } = createRecordingWatcher(t);

  watcher.sync(root, [""]);
  watcher.stopRoot(makeTempDir());
  await writeUntilNotified(changes, root, "", root);

  watcher.stopRoot(root);
  await waitPastDebounce();
  changes.length = 0;
  fs.writeFileSync(path.join(root, "after-stop.txt"), "x");
  await waitPastDebounce();
  assert.deepEqual(changes, []);
});

test("FileTreeWatcher は無いディレクトリを監視対象から飛ばす", (t) => {
  const root = makeTempDir();
  const { watcher } = createRecordingWatcher(t);

  assert.doesNotThrow(() => watcher.sync(root, ["", "missing"]));
});
