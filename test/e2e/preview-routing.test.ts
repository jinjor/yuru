import { expect, test, type ElectronApplication } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  closeYuru,
  createCommittedRepo,
  createE2eContext,
  expectPreviewPath,
  launchWindow,
  openMainTerminal,
  registerRepo,
} from "./helpers";
import { makePdf } from "./pdf-fixture";

test("画像・音声・PDF はテキスト差分 API を呼ばずに表示する", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    await writeFile(
      path.join(repoDir, "picture.png"),
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=",
        "base64",
      ),
    );
    await writeFile(path.join(repoDir, "document.pdf"), makePdf(1));
    // 8 kHz / 8 bit / mono、1 秒の無音。
    const wav = Buffer.alloc(44 + 8000, 128);
    wav.write("RIFF", 0);
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(8000, 24);
    wav.writeUInt32LE(8000, 28);
    wav.writeUInt16LE(1, 32);
    wav.writeUInt16LE(8, 34);
    wav.write("data", 36);
    wav.writeUInt32LE(8000, 40);
    await writeFile(path.join(repoDir, "sound.wav"), wav);
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;
    await openMainTerminal(window);
    // テキスト差分を取得できない状態でも各プレビューが表示されることを確認する。
    await app.evaluate(({ ipcMain }) => {
      const calls: string[] = [];
      (globalThis as { __textDiffRequests?: string[] }).__textDiffRequests = calls;
      ipcMain.removeHandler("git:diffDocument");
      ipcMain.handle("git:diffDocument", (_event, _worktreeId, filePath: string) => {
        calls.push(filePath);
        return { ok: true, data: null };
      });
    });
    await window.locator(".panel-tabs .tab", { hasText: "Files" }).click();
    for (const [file, selector] of [
      ["picture.png", ".image-preview"],
      ["sound.wav", ".media-preview audio"],
      ["document.pdf", ".pdf-preview-frame"],
    ]) {
      await window.locator(".file-tree-row", { hasText: file }).click();
      await expectPreviewPath(window, file);
      await expect(window.locator(selector)).toBeVisible();
      if (file === "picture.png") {
        await expect
          .poll(() =>
            window
              .locator(".image-preview img")
              .evaluate((image) => (image as HTMLImageElement).naturalWidth),
          )
          .toBe(1);
      }
      await expect(
        window.getByRole("button", { name: "Binary files cannot be edited" }),
      ).toBeDisabled();
      await expect(window.locator(".preview-header .line-stat")).toBeHidden();
      await window.getByRole("button", { name: "View", exact: true }).click();
      await expect(window.locator(".preview-body")).toHaveText("Binary preview is not available");
      await window.getByRole("button", { name: "Preview", exact: true }).click();
      await expect(window.locator(selector)).toBeVisible();
    }
    expect(
      await app.evaluate(
        () => (globalThis as { __textDiffRequests?: string[] }).__textDiffRequests,
      ),
    ).toEqual([]);
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("SVG は画像プレビューとテキストの閲覧・編集を切り替えられる", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const svg = (color: string) =>
      `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="${color}"/></svg>\n`;
    const repoDir = await createCommittedRepo(context, { "icon.svg": svg("red") });
    await writeFile(path.join(repoDir, "icon.svg"), svg("blue"));
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;
    await openMainTerminal(window);
    await window.locator(".change-item", { hasText: "icon.svg" }).click();
    await expectPreviewPath(window, "icon.svg");
    await expect(window.locator(".image-preview img")).toHaveCount(2);
    await expect(window.locator(".preview-header .line-stat")).toHaveText("+1-1");
    await window.getByRole("button", { name: "View", exact: true }).click();
    await expect(window.locator(".source-line.diff-added")).toContainText('fill="blue"');
    await expect(window.locator(".source-line.diff-deleted")).toContainText('fill="red"');
    await window.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(window.locator(".cm-content")).toContainText('fill="blue"');
    await window.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(window.locator(".image-preview img")).toHaveCount(2);
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});
