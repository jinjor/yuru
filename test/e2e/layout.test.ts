import { expect, test, type ElectronApplication, type Locator, type Page } from "@playwright/test";
import {
  closeYuru,
  createCommittedRepo,
  createE2eContext,
  createGitWorktree,
  launchWindow,
  openMainTerminal,
  registerRepo,
  writeFiles,
} from "./helpers";

test("初期表示ではターミナルの幅を保ったまま右ペインが広い", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;
    await openMainTerminal(window);

    await expect(window.locator(".changes-panel")).toBeVisible();
    expect(await elementWidth(window.locator(".changes-panel"))).toBe(375);
    expect(await elementWidth(window.locator(".worktree-view-column"))).toBe(758);
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("サイドバーのリサイズで幅が clamp 範囲内で変わる", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;

    const sidebar = window.locator(".sidebar");
    const before = await elementWidth(sidebar);
    await dragHandle(window, window.locator(".app > .pane-resize-handle.vertical").first(), 70, 0);
    const after = await elementWidth(sidebar);

    expect(after).toBeGreaterThan(before);
    expect(after).toBeGreaterThanOrEqual(220);
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("worktree が多い時も左ペインの repo 一覧をスクロールできる", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    for (let index = 0; index < 18; index += 1) {
      await createGitWorktree(context, repoDir, `long-list-${index.toString().padStart(2, "0")}`);
    }
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;

    const repoList = window.locator(".repo-list");
    await expect(repoList).toBeVisible();
    const scrollState = await repoList.evaluate((element) => {
      element.scrollTop = 0;
      element.scrollTop = element.scrollHeight;
      return {
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        scrollTop: element.scrollTop,
      };
    });

    expect(scrollState.scrollHeight).toBeGreaterThan(scrollState.clientHeight);
    expect(scrollState.scrollTop).toBeGreaterThan(0);
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("Changes パネルのリサイズで幅が変わる", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;
    await openMainTerminal(window);

    const changesPanel = window.locator(".changes-panel");
    const before = await elementWidth(changesPanel);
    await dragHandle(
      window,
      window.locator(".worktree-view-column + .pane-resize-handle.vertical"),
      -80,
      0,
    );
    const after = await elementWidth(changesPanel);

    expect(after).toBeGreaterThan(before);
    expect(after).toBeGreaterThanOrEqual(220);
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("プレビュー分割のリサイズで preview の高さが変わる", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context, {
      "README.md": "# original\n",
    });
    await writeFiles(repoDir, {
      "README.md": "# changed\n",
    });
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;
    await openMainTerminal(window);

    await window.locator(".change-item", { hasText: "README.md" }).click();
    await expect(window.locator(".preview-panel")).toBeVisible();
    const previewPanel = window.locator(".preview-panel");
    const before = await elementHeight(previewPanel);
    await dragHandle(window, window.locator(".worktree-view-split-handle"), 0, 80);
    const after = await elementHeight(previewPanel);

    expect(after).toBeGreaterThan(before);
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("HTML プレビューの上までドラッグしても分割を動かせ、離せば止まる", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context, {
      "README.md": "# e2e\n",
      "mock/index.html": "<!doctype html>\n<html><body><p>mock</p></body></html>\n",
    });
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;
    await openMainTerminal(window);

    await window.locator(".panel-tabs .tab", { hasText: "Files" }).click();
    await window.locator(".file-tree-row", { hasText: "mock" }).click();
    await window.locator(".file-tree-row", { hasText: "index.html" }).click();
    await expect(window.locator(".html-preview-frame")).toBeVisible();

    const previewPanel = window.locator(".preview-panel");
    const before = await elementHeight(previewPanel);
    const box = await window.locator(".worktree-view-split-handle").boundingBox();
    expect(box).not.toBeNull();
    const startX = box!.x + box!.width / 2;
    const startY = box!.y + box!.height / 2;

    // 上へ動かすとポインタは preview の iframe に入る。
    await window.mouse.move(startX, startY);
    await window.mouse.down();
    await window.mouse.move(startX, startY - 80, { steps: 4 });
    await window.mouse.up();
    const afterDrag = await elementHeight(previewPanel);
    expect(afterDrag).toBeLessThan(before);

    // 離した後のポインタ移動では分割は動かない。
    await window.mouse.move(startX, startY + 120, { steps: 4 });
    expect(await elementHeight(previewPanel)).toBe(afterDrag);
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

async function dragHandle(window: Page, handle: Locator, deltaX: number, deltaY: number): Promise<void> {
  const box = await handle.boundingBox();
  expect(box).not.toBeNull();
  const startX = box!.x + box!.width / 2;
  const startY = box!.y + box!.height / 2;
  await window.mouse.move(startX, startY);
  await window.mouse.down();
  await window.mouse.move(startX + deltaX, startY + deltaY, { steps: 4 });
  await window.mouse.up();
}

async function elementWidth(locator: Locator): Promise<number> {
  return locator.evaluate((element) => element.getBoundingClientRect().width);
}

async function elementHeight(locator: Locator): Promise<number> {
  return locator.evaluate((element) => element.getBoundingClientRect().height);
}
