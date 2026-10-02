import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import {
  closeYuru,
  createCommittedRepo,
  createE2eContext,
  launchWindow,
  PROMPT_TYPE_DELAY_MS,
  registerRepo,
  visibleWorktreeView,
  worktreeCard,
} from "./helpers";

const BRANCH = "activity-devin";
const PICKER_FOOTER = "↑↓ select · ↵ confirm · esc cancel";
const QUESTION_FOOTER = "↑↓ navigate · ↵ select · ? help me out · esc cancel";

test("Devin: 選択肢の再描画中は待機し、選択後は作業中に戻る", async () => {
  test.setTimeout(150_000);
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    await registerRepo(context, repoDir);
    await seedDevinHome(context.tmpHome, repoDir);
    const launched = await launchWindow(context, {
      env: {
        XDG_CONFIG_HOME: path.join(context.tmpHome, ".config"),
        XDG_DATA_HOME: path.join(context.tmpHome, ".local", "share"),
        CHISEL_SESSION_DB: path.join(
          context.tmpHome,
          ".local",
          "share",
          "devin",
          "cli",
          "sessions.db",
        ),
        DEVIN_PERMISSION_MODE: "auto",
      },
    });
    app = launched.app;
    const window = launched.window;
    await window.locator(".repo-row-new-btn").click();
    await window.locator(".worktree-input-row .text-input").fill(BRANCH);
    await window.locator(".worktree-input-row .button").click();
    await visibleWorktreeView(window).locator(".new-session-action", { hasText: "Devin" }).click();
    const terminal = visibleWorktreeView(window).locator(".xterm");
    await expect(terminal).toContainText("Devin CLI", { timeout: 30_000 });
    await expectActivity(window, "waiting");

    await submitPrompt(window, "/model");
    await expect(terminal).toContainText("reasoning effort", { timeout: 20_000 });
    await expectActivity(window, "waiting");
    await assertWaitingDuringRedraw(app, window);
    await window.keyboard.press("Escape");
    await expect(terminal).not.toContainText("reasoning effort");

    await submitPrompt(
      window,
      "Use the exec tool to run exactly: sleep 5; printf DEVIN_ACTIVITY_DONE. Do not run other tools.",
    );
    await expectActivity(window, "working");
    await expect(terminal).toContainText("(Approve once)", { timeout: 60_000 });
    await expect(terminal).toContainText(PICKER_FOOTER);
    await expectActivity(window, "waiting");
    await assertWaitingDuringRedraw(app, window);

    // Approve only the harmless command above; its five-second wait leaves
    // enough time to observe working after the picker disappears.
    await window.keyboard.press("Enter");
    await expect(terminal).not.toContainText(PICKER_FOOTER);
    await expectActivity(window, "working");
    await expect(terminal).toContainText("Ask Devin to build features", { timeout: 45_000 });
    await expectActivity(window, "waiting");
    await assertWaitingDuringRedraw(app, window);

    await submitPrompt(
      window,
      "Use the clarification tool to ask me to choose one option: Red or Blue. Do not choose for me.",
    );
    await expectActivity(window, "working");
    await expect(terminal).toContainText(QUESTION_FOOTER, { timeout: 60_000 });
    await expectActivity(window, "waiting");
    await assertWaitingDuringRedraw(app, window);
    await window.keyboard.press("Enter");
    await expect(terminal).not.toContainText(QUESTION_FOOTER);
    await expect(terminal).toContainText("Ask Devin to build features", { timeout: 45_000 });
    await expectActivity(window, "waiting");
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

async function seedDevinHome(home: string, repoDir: string): Promise<void> {
  const configDir = path.join(home, ".config", "devin");
  const dataDir = path.join(home, ".local", "share", "devin");
  await mkdir(configDir, { recursive: true });
  await mkdir(path.join(dataDir, "cli"), { recursive: true });
  await copyFile(
    path.join(homedir(), ".local", "share", "devin", "credentials.toml"),
    path.join(dataDir, "credentials.toml"),
  );
  const realConfig = JSON.parse(
    await readFile(path.join(homedir(), ".config", "devin", "config.json"), "utf8"),
  ) as { devin?: { org_id?: string } };
  await writeFile(
    path.join(configDir, "config.json"),
    JSON.stringify({
      version: 1,
      devin: { org_id: realConfig.devin?.org_id },
      shell: { setup_complete: true },
      auto_update: false,
      notify: "never",
      show_hints: false,
      subagents_enabled: false,
      permissions: { ask: ["Exec(*)"] },
      read_config_from: { agents_standard: false, claude: false },
    }),
  );
  await writeFile(
    path.join(dataDir, "cli", "trusted_workspaces.json"),
    JSON.stringify({ trusted_paths: [repoDir] }),
  );
}

async function submitPrompt(window: Page, prompt: string): Promise<void> {
  await visibleWorktreeView(window).locator(".xterm").click();
  await window.keyboard.type(prompt, { delay: PROMPT_TYPE_DELAY_MS });
  await window.waitForTimeout(300);
  await window.keyboard.press("Enter");
}

async function expectActivity(window: Page, activity: "working" | "waiting"): Promise<void> {
  await expect(sessionDot(window, activity)).toBeVisible({ timeout: 30_000 });
}

function sessionDot(window: Page, activity: "working" | "waiting") {
  return worktreeCard(window, BRANCH).locator(
    `[aria-label="Devin primary session active · ${activity}"]`,
  );
}

async function assertWaitingDuringRedraw(app: ElectronApplication, window: Page): Promise<void> {
  const bounds = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getBounds(),
  );
  try {
    for (let index = 0; index < 25; index += 1) {
      await app.evaluate(
        ({ BrowserWindow }, { width, height }) =>
          BrowserWindow.getAllWindows()[0].setSize(width, height),
        { width: bounds.width + (index % 2) * 40, height: bounds.height },
      );
      await window.waitForTimeout(200);
      expect(await sessionDot(window, "waiting").isVisible()).toBe(true);
    }
  } finally {
    await app.evaluate(
      ({ BrowserWindow }, bounds) => BrowserWindow.getAllWindows()[0].setBounds(bounds),
      bounds,
    );
  }
}
