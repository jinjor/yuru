import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import {
  claudeHasAssistantReply,
  closeYuru,
  codexHasAssistantReply,
  createCommittedRepo,
  createE2eContext,
  launchWindow,
  PROMPT_TYPE_DELAY_MS,
  registerRepo,
  seedClaudeHome,
  seedCodexHome,
  visibleWorktreeView,
  worktreeCard,
  type E2eContext,
} from "./helpers";

interface ProviderActivityE2e {
  id: "claude" | "codex";
  label: "Claude" | "Codex";
  branchName: string;
  modelCommandCompleteText: string;
  seedHome(home: string, trustedRepoPath: string): Promise<void>;
  hasAssistantReply(home: string, cwd: string): boolean;
  waitForReady(window: Page): Promise<void>;
}

const providers: ProviderActivityE2e[] = [
  {
    id: "claude",
    label: "Claude",
    branchName: "activity-claude",
    modelCommandCompleteText: "Set model to",
    seedHome: seedClaudeHome,
    hasAssistantReply: claudeHasAssistantReply,
    async waitForReady(window) {
      await expect(visibleWorktreeView(window).locator(".xterm")).toContainText("Claude Code", {
        timeout: 30_000,
      });
      await window.waitForTimeout(9000);
    },
  },
  {
    id: "codex",
    label: "Codex",
    branchName: "activity-codex",
    modelCommandCompleteText: "Model changed to",
    seedHome: seedCodexHome,
    hasAssistantReply: (home) => codexHasAssistantReply(home),
    async waitForReady(window) {
      await expect(visibleWorktreeView(window).locator(".xterm")).toContainText("OpenAI Codex", {
        timeout: 30_000,
      });
      await window.waitForTimeout(1000);
    },
  },
];

for (const provider of providers) {
  test(`${provider.label}: active session の activity 表示を実 provider の状態から更新する`, async () => {
    test.setTimeout(120_000);
    const context = await createE2eContext();
    let app: ElectronApplication | null = null;
    try {
      const repoDir = await createCommittedRepo(context);
      await registerRepo(context, repoDir);
      await provider.seedHome(context.tmpHome, repoDir);

      const launched = await launchWindow(context);
      app = launched.app;
      const window = launched.window;

      await startWorktreeSession(window, provider);
      await expectActivity(window, provider, "waiting");

      await runNormalConversation(context, window, provider, repoDir);
      if (provider.id === "codex") {
        await runPermissionPrompt(window, provider);
      }
      await runModelCommand(window, provider);
      await runInterrupt(window, provider);
    } finally {
      await closeYuru(app);
      await context.cleanup();
    }
  });
}

async function startWorktreeSession(window: Page, provider: ProviderActivityE2e): Promise<void> {
  await window.locator(".repo-row-new-btn").click();
  await window.locator(".worktree-input-row .text-input").fill(provider.branchName);
  await window.locator(".worktree-input-row .button").click();
  // worktree 作成後、Terminal の session start surface から provider を選ぶ。
  const sessionView = visibleWorktreeView(window);
  await sessionView.locator(".new-session-action", { hasText: provider.label }).click();
  await expect(sessionView.locator(".xterm")).toBeVisible({ timeout: 30_000 });
  await provider.waitForReady(window);
}

async function runNormalConversation(
  context: E2eContext,
  window: Page,
  provider: ProviderActivityE2e,
  repoDir: string,
): Promise<void> {
  const marker = `ACTIVITY_NORMAL_${provider.id.toUpperCase()}`;
  // marker は返答の末尾に置かせる。preview は最後の assistant メッセージだけを表示する
  // ため、返答が複数メッセージに分割されても末尾なら preview に残る。
  await submitPrompt(
    window,
    `List the numbers 1 to 20, one per line, then end your reply with ${marker}. Do not use tools.`,
  );
  await expectActivity(window, provider, "working", 30_000);
  await expect(() => {
    expect(provider.hasAssistantReply(context.tmpHome, repoDir)).toBe(true);
  }).toPass({ timeout: 90_000 });
  await expectActivity(window, provider, "waiting", 30_000);
  // カードのプレビューが、操作なしで最新の assistant メッセージに更新される
  await expect(
    worktreeCard(window, provider.branchName).locator(".task-worktree-session-preview"),
  ).toContainText(marker, { timeout: 15_000 });
}

async function runModelCommand(window: Page, provider: ProviderActivityE2e): Promise<void> {
  await submitPrompt(window, "/model");
  await window.waitForTimeout(1000);
  await window.keyboard.press("Enter");
  if (provider.id === "codex") {
    await expect(visibleWorktreeView(window).locator(".xterm")).toContainText(
      "Select Reasoning Level",
      {
        timeout: 20_000,
      },
    );
    await window.keyboard.press("Enter");
  }
  await expect(visibleWorktreeView(window).locator(".xterm")).toContainText(
    provider.modelCommandCompleteText,
    {
      timeout: 20_000,
    },
  );
  await expectActivity(window, provider, "waiting", 20_000);
}

async function runPermissionPrompt(window: Page, provider: ProviderActivityE2e): Promise<void> {
  await submitPrompt(
    window,
    [
      "Run exactly this shell command and nothing else: curl -I https://example.com.",
      "Request escalated permissions before executing it.",
    ].join(" "),
  );
  await expectActivity(window, provider, "working", 30_000);
  await expect(visibleWorktreeView(window).locator(".xterm")).toContainText(
    "Would you like to run the following command?",
    { timeout: 60_000 },
  );
  // Codex keeps repainting the Action Required title and spinner while the
  // permission menu is open. That output must not make the session look busy.
  await expectActivity(window, provider, "waiting", 10_000);
  await window.keyboard.press("Escape");
  await expect(visibleWorktreeView(window).locator(".xterm")).toContainText("canceled", {
    timeout: 10_000,
  });
  await expectActivity(window, provider, "waiting", 20_000);
}

async function runInterrupt(window: Page, provider: ProviderActivityE2e): Promise<void> {
  const startedMarker = "ACTIVITY_INTERRUPT";
  await submitPrompt(
    window,
    [
      "First print the two words ACTIVITY and INTERRUPT separated by a single underscore.",
      "Then keep listing integers, one per line, until interrupted.",
      "Do not ask for confirmation and do not stop on your own.",
    ].join(" "),
  );
  await expectActivity(window, provider, "working", 30_000);
  await expect(visibleWorktreeView(window).locator(".xterm")).toContainText(startedMarker, {
    timeout: 30_000,
  });
  await visibleWorktreeView(window).locator(".xterm").click();
  await window.keyboard.press("Control+C");
  await expectActivity(window, provider, "waiting", 20_000);
}

async function submitPrompt(window: Page, prompt: string): Promise<void> {
  await visibleWorktreeView(window).locator(".xterm").click();
  await window.keyboard.type(prompt, { delay: PROMPT_TYPE_DELAY_MS });
  await window.waitForTimeout(300);
  await window.keyboard.press("Enter");
}

async function expectActivity(
  window: Page,
  provider: ProviderActivityE2e,
  activity: "working" | "waiting",
  timeout = 30_000,
): Promise<void> {
  try {
    await expect(sessionDot(window, provider, activity)).toBeVisible({ timeout });
  } catch (error) {
    throw new Error(
      [
        `Timed out waiting for ${provider.label} activity ${activity}.`,
        "Session dot labels:",
        ...(await readSessionDotLabels(window, provider)),
        "Terminal snapshot:",
        await readTerminalText(window),
      ].join("\n"),
      { cause: error },
    );
  }
}

function sessionDot(window: Page, provider: ProviderActivityE2e, activity: "working" | "waiting") {
  return worktreeCard(window, provider.branchName).locator(
    `[aria-label="${provider.label} primary session active · ${activity}"]`,
  );
}

async function readTerminalText(window: Page): Promise<string> {
  const terminal = visibleWorktreeView(window).locator(".xterm");
  return (await terminal.count()) === 0
    ? "(terminal missing)"
    : terminal.evaluate((element) => element.querySelector(".xterm-rows")?.textContent ?? "");
}

async function readSessionDotLabels(
  window: Page,
  provider: ProviderActivityE2e,
): Promise<string[]> {
  return worktreeCard(window, provider.branchName)
    .locator(".session-provider-dot")
    .evaluateAll((dots) => dots.map((dot) => dot.getAttribute("aria-label") ?? "(no aria-label)"));
}
