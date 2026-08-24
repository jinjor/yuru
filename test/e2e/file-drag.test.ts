import { expect, test, type ElectronApplication, type Locator, type Page } from "@playwright/test";
import {
  closeYuru,
  createCommittedRepo,
  createE2eContext,
  launchWindow,
  openMainTerminal,
  registerRepo,
  visibleWorktreeView,
  writeFiles,
} from "./helpers";

test("Files と Changes のファイルを Terminal にドロップすると相対パスを貼り付ける", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context, {
      "docs/guide.md": "# Guide\n",
      "src/changed.ts": "export const value = 1;\n",
    });
    await writeFiles(repoDir, {
      "src/changed.ts": "export const value = 2;\n",
    });
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;
    await openMainTerminal(window);

    const sessionView = visibleWorktreeView(window);
    const terminalHost = sessionView.locator(".terminal-host");
    const terminal = sessionView.locator(".xterm");

    const changedFile = sessionView.locator(".change-item", { hasText: "changed.ts" });
    await expect(changedFile).toHaveAttribute("draggable", "true", { timeout: 10_000 });
    await expectDroppedRelativePath(window, changedFile, terminalHost, "src/changed.ts");
    await expect(terminal).toContainText("DROPPED=<src/changed.ts>");

    await sessionView.locator(".panel-tabs .tab", { hasText: "Files" }).click();
    const docsDirectory = sessionView.locator(".file-tree-row", { hasText: "docs" });
    await expect(docsDirectory).toHaveAttribute("draggable", "false");
    await docsDirectory.click();
    const guideFile = sessionView.locator(".file-tree-row", { hasText: "guide.md" });
    await expect(guideFile).toHaveAttribute("draggable", "true");
    await expectDroppedRelativePath(window, guideFile, terminalHost, "docs/guide.md");
    await expect(terminal).toContainText("DROPPED=<docs/guide.md>");
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

async function expectDroppedRelativePath(
  window: Page,
  source: Locator,
  terminalHost: Locator,
  relativePath: string,
): Promise<void> {
  await terminalHost.click();
  await window.keyboard.type("printf 'DROPPED=<%s>\\n' ");
  await source.dragTo(terminalHost);
  await window.keyboard.press("Enter");
  await expect(terminalHost.locator(".xterm")).toContainText(`DROPPED=<${relativePath}>`, {
    timeout: 10_000,
  });
}
