import { expect, test, type ElectronApplication, type Locator, type Page } from "@playwright/test";
import {
  closeYuru,
  createCommittedRepo,
  createE2eContext,
  launchWindow,
  openMainTerminal,
  registerRepo,
  writeFiles,
} from "./helpers";

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
    await dragHandle(window, window.locator(".session-view-column + .pane-resize-handle.vertical"), -80, 0);
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
    await dragHandle(window, window.locator(".session-view-split-handle"), 0, 80);
    const after = await elementHeight(previewPanel);

    expect(after).toBeGreaterThan(before);
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
