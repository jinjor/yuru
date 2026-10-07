import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import path from "node:path";
import {
  closeYuru,
  createCommittedRepo,
  createE2eContext,
  launchWindow,
  visibleWorktreeView,
  writeMetadata,
} from "./helpers";

function mainTerminalCard(window: Page, repo: string) {
  return window
    .locator(".repo-group", { hasText: repo })
    .locator(".task-worktree-card", { hasText: "terminal" });
}

async function exerciseMouse(window: Page): Promise<void> {
  const view = visibleWorktreeView(window);
  const rows = view.locator(".xterm-rows");
  const row = rows.locator(":scope > div", { hasText: "MOUSE_TARGET" });
  await expect(row).toBeVisible();
  const box = (await row.boundingBox())!;
  const cellWidth = await row
    .locator("span")
    .first()
    .evaluate((span) => {
      return span.getBoundingClientRect().width / span.textContent!.length;
    });
  // 旧形式では column + 32 が 0x80 以上になる座標を使い、UTF-8 化による破損も検出する。
  const endColumn = 110;
  expect(box.width).toBeGreaterThan(cellWidth * endColumn);
  const y = box.y + box.height / 2;
  const before = await rows.textContent();
  const dragCount = Number(/DRAGS_(\d+)/.exec(before!)![1]);
  const scrollCount = Number(/SCROLLS_(\d+)/.exec(before!)![1]);

  await window.mouse.move(box.x + 2, y);
  await window.mouse.down();
  await window.mouse.move(box.x + cellWidth * endColumn + 1, y, { steps: 5 });
  await window.mouse.up();
  await expect
    .poll(async () => {
      return Number(/DRAGS_(\d+)/.exec((await rows.textContent())!)![1]);
    })
    .toBeGreaterThan(dragCount);
  await expect
    .poll(async () => {
      const column = Number(/COL_(\d+)/.exec((await rows.textContent())!)![1]);
      return Math.abs(column - (endColumn + 1));
    })
    .toBeLessThanOrEqual(1);
  // 選択は TUI が描画する。Yuru 側でドラッグを奪っていないことも確認する。
  await expect(view.locator(".xterm-selection > div")).toHaveCount(0);

  await window.mouse.wheel(0, 100);
  await expect
    .poll(async () => {
      return Number(/SCROLLS_(\d+)/.exec((await rows.textContent())!)![1]);
    })
    .toBeGreaterThan(scrollCount);
}

for (const encoding of ["sgr", "legacy"]) {
  test(`${encoding} マウス入力で表示切り替え後も TUI の選択・スクロールが動く`, async () => {
    const context = await createE2eContext();
    let app: ElectronApplication | null = null;
    try {
      const first = await createCommittedRepo(context);
      const second = await createCommittedRepo(context);
      await writeMetadata(context, {
        repos: [
          { id: "repo-1", repoPath: first },
          { id: "repo-2", repoPath: second },
        ],
        taskWorktrees: [],
      });
      const launched = await launchWindow(context);
      app = launched.app;
      const window = launched.window;
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]!.setSize(1800, 1000);
      });
      await mainTerminalCard(window, first).click();
      await expect(visibleWorktreeView(window).locator(".xterm")).toBeVisible();
      await visibleWorktreeView(window).locator(".xterm").click();
      const fixture = path.join(context.repoRoot, "test/e2e/fixtures/mouse-tui.mjs");
      const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
      await window.keyboard.type(`${quote(process.execPath)} ${quote(fixture)} ${encoding}`);
      await window.keyboard.press("Enter");
      await exerciseMouse(window);

      // 別 worktree を表示して戻ると、PTY の画面と入力モードが復元される。
      // 同じ TUI プロセスへのドラッグ・ホイール入力が続くことを確認する。
      for (let i = 0; i < 2; i++) {
        await mainTerminalCard(window, second).click();
        await expect(visibleWorktreeView(window).locator(".xterm-rows")).toContainText(
          path.basename(second),
        );
        await mainTerminalCard(window, first).click();
        await exerciseMouse(window);
      }

      // TUI がマウス入力を解除した後は、通常の端末の文字選択に戻る。
      await window.keyboard.press("Control+c");
      await expect(visibleWorktreeView(window).locator(".xterm-rows")).not.toContainText(
        "MOUSE_TARGET",
      );
      await window.keyboard.type("T='日本語🙂'; printf '\\nNATIVE_%s\\n' \"$T\"");
      await window.keyboard.press("Enter");
      const row = visibleWorktreeView(window).locator(".xterm-rows > div", {
        hasText: "NATIVE_日本語🙂",
      });
      await expect(row).toBeVisible();
      const box = (await row.boundingBox())!;
      await window.mouse.move(box.x + 2, box.y + box.height / 2);
      await window.mouse.down();
      await window.mouse.move(box.x + 70, box.y + box.height / 2, { steps: 5 });
      await window.mouse.up();
      await expect(visibleWorktreeView(window).locator(".xterm-selection > div")).not.toHaveCount(
        0,
      );
    } finally {
      await closeYuru(app);
      await context.cleanup();
    }
  });
}
