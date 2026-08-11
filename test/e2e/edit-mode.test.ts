import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
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
  writeFiles,
} from "./helpers";

// 編集アイコン (モードセグメントの右側 = 編集)。
function editButton(window: Page) {
  return window.locator(".preview-mode-segment button").nth(1);
}

test("編集モードで編集するとディスクへ自動保存され、ガターと overview ruler に変更行が出る", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context, {
      "README.md": "# e2e\n",
      "src/app.ts": "export const a = 1;\n",
    });
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;
    await openMainTerminal(window);

    await window.locator(".panel-tabs .tab", { hasText: "Files" }).click();
    await window.locator(".file-tree-row", { hasText: "src" }).click();
    await window.locator(".file-tree-row", { hasText: "app.ts" }).click();
    await expectPreviewPath(window, "src/app.ts");

    await editButton(window).click();
    await expect(window.locator(".cm-editor")).toBeVisible();
    await expect(window.locator(".cm-content")).toContainText("export const a = 1;");

    await window.locator(".cm-content").click();
    await window.keyboard.press("Meta+A");
    await window.keyboard.type("export const edited = true;");

    // debounce 後に作業ツリーのファイルへ書き込まれる
    await expect
      .poll(() => readFileSync(path.join(repoDir, "src/app.ts"), "utf8"), { timeout: 7_000 })
      .toContain("export const edited = true;");

    await expect(window.locator(".cm-change-mark-added").first()).toBeVisible();
    await expect(window.locator(".cm-editor .diff-overview-mark.diff-added").first()).toBeVisible();
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("staged 差分では編集が無効で、unstaged からは作業ツリーを編集できる", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context, { "note.txt": "v1\n" });
    // HEAD=v1, index=v2, 作業ツリー=v3 と 3 者をずらす
    await writeFiles(repoDir, { "note.txt": "v2\n" });
    git(["add", "note.txt"], repoDir);
    await writeFiles(repoDir, { "note.txt": "v3\n" });
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;
    await openMainTerminal(window);

    const stagedSection = window
      .locator(".change-section")
      .filter({ has: window.locator(".change-section-header", { hasText: /^Staged/ }) });
    const unstagedSection = window
      .locator(".change-section")
      .filter({ has: window.locator(".change-section-header", { hasText: /^Unstaged/ }) });

    // staged (HEAD ↔ index) を開くと、index を見ているので編集は無効
    await stagedSection.locator(".change-item", { hasText: "note.txt" }).click();
    await expect(window.locator(".source-line.diff-added")).toContainText("v2");
    await expect(editButton(window)).toBeDisabled();

    // unstaged (index ↔ 作業ツリー) からは編集でき、エディタは作業ツリー (v3) を出す
    await unstagedSection.locator(".change-item", { hasText: "note.txt" }).click();
    await expect(editButton(window)).toBeEnabled();
    await editButton(window).click();
    await expect(window.locator(".cm-content")).toContainText("v3");
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("バイナリファイルは編集アイコンが無効になる", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context, { "README.md": "# e2e\n" });
    writeFileSync(path.join(repoDir, "logo.bin"), Buffer.from([0x89, 0x50, 0x00, 0x4e, 0x00, 0x47]));
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;
    await openMainTerminal(window);

    await window.locator(".panel-tabs .tab", { hasText: "Files" }).click();
    await window.locator(".file-tree-row", { hasText: "logo.bin" }).click();
    await expectPreviewPath(window, "logo.bin");

    await expect(window.locator(".preview-body .empty-state")).toContainText(
      "Binary preview is not available",
    );
    await expect(editButton(window)).toBeDisabled();
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("削除済みファイルは編集に入れず、保存でも復活しない", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context, { "gone.txt": "bye\n" });
    await rm(path.join(repoDir, "gone.txt"));
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;
    await openMainTerminal(window);

    const changeItem = window.locator(".change-item", { hasText: "gone.txt" });
    await expect(changeItem).toContainText("D", { timeout: 10_000 });
    await changeItem.click();
    await expectPreviewPath(window, "gone.txt");

    await editButton(window).click();
    await expect(window.locator(".preview-body .empty-state")).toContainText("no longer exists");

    // 削除済みファイルを保存で復活させていない
    expect(existsSync(path.join(repoDir, "gone.txt"))).toBe(false);
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});
