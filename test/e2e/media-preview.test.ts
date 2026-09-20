import { expect, test, type ElectronApplication } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  closeYuru,
  createCommittedRepo,
  createE2eContext,
  expectPreviewPath,
  git,
  launchWindow,
  openMainTerminal,
  registerRepo,
  visibleWorktreeView,
} from "./helpers";

test("変更した音声は前後を並べ、長さとサイズで比べられる", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    await writeFile(path.join(repoDir, "theme.wav"), makeWav(1));
    git(["add", "theme.wav"], repoDir);
    git(["commit", "-m", "add theme"], repoDir);
    // 長さを変える (並んだメタ情報で差が読めることを確認する)
    await writeFile(path.join(repoDir, "theme.wav"), makeWav(2));
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;
    await openMainTerminal(window);

    await window.locator(".change-item", { hasText: "theme.wav" }).click();
    await expectPreviewPath(window, "theme.wav");

    const sessionView = visibleWorktreeView(window);
    // 再生はブラウザのコントロールに任せる。要素が両側にあることだけ確かめる。
    await expect(sessionView.locator(".media-preview audio")).toHaveCount(2);
    await expect(sessionView.locator(".diff-side", { hasText: "Before" })).toContainText("0:01");
    await expect(sessionView.locator(".diff-side", { hasText: "After" })).toContainText("0:02");

    // バイナリなのでヘッダに行数は出さない
    await expect(sessionView.locator(".line-stat")).toBeHidden();
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("開いている間に音声が書き換わったら表示も追従する", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    await writeFile(path.join(repoDir, "live.wav"), makeWav(1));
    git(["add", "live.wav"], repoDir);
    git(["commit", "-m", "add live"], repoDir);
    await writeFile(path.join(repoDir, "live.wav"), makeWav(2));
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;
    await openMainTerminal(window);

    await window.locator(".change-item", { hasText: "live.wav" }).click();
    const sessionView = visibleWorktreeView(window);
    await expect(sessionView.locator(".diff-side", { hasText: "After" })).toContainText("0:02");

    // 作業ツリー側は同じパスを指したままなので、URL が変わらなくても読み直す必要がある。
    // 画面が古い中身のまま取り残されると、聴いていないものを Reviewed にできてしまう。
    await writeFile(path.join(repoDir, "live.wav"), makeWav(3));
    await expect(sessionView.locator(".diff-side", { hasText: "After" })).toContainText("0:03", {
      timeout: 10_000,
    });
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("追加された音声と worktree の音声は 1 面で表示する", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    await writeFile(path.join(repoDir, "sting.wav"), makeWav(1));
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;
    await openMainTerminal(window);
    const sessionView = visibleWorktreeView(window);

    // 未追跡ファイル = 追加なので、比較する元がない
    await window.locator(".change-item", { hasText: "sting.wav" }).click();
    await expectPreviewPath(window, "sting.wav");
    await expect(sessionView.locator(".diff-side-label")).toHaveText("Added");
    await expect(sessionView.locator(".media-preview audio")).toHaveCount(1);
    await expect(sessionView.locator(".diff-side-meta")).toContainText("0:01");

    // Files から開いた変更なしの音声も 1 面のまま
    git(["add", "sting.wav"], repoDir);
    git(["commit", "-m", "add sting"], repoDir);
    await sessionView.locator(".panel-tabs .tab", { hasText: "Files" }).click();
    await sessionView.locator(".file-tree-row", { hasText: "sting.wav" }).click();
    await expect(sessionView.locator(".diff-side-label")).toBeHidden();
    await expect(sessionView.locator(".media-preview audio")).toHaveCount(1);
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

// 無音の WAV を組み立てる (テスト用の音声を外部ファイルとして持たないため)。
// 16bit PCM モノラル 8 kHz で、seconds 秒ぶんのサンプルを置く。
function makeWav(seconds: number): Buffer {
  const sampleRate = 8000;
  const dataSize = sampleRate * seconds * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16); // fmt チャンクの長さ
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // モノラル
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28); // バイト毎秒
  buffer.writeUInt16LE(2, 32); // ブロックサイズ
  buffer.writeUInt16LE(16, 34); // ビット深度
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}
