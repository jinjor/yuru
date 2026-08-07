import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  claudeConversationCount,
  claudeHasAssistantReply,
  closeYuru,
  codexConversationCount,
  codexHasAssistantReply,
  createCommittedRepo,
  createE2eContext,
  createExternalClaudeSession,
  createExternalCodexSession,
  createGitWorktree,
  launchWindow,
  openMainTerminal,
  PROMPT_TYPE_DELAY_MS,
  registerRepo,
  seedClaudeHome,
  seedCodexHome,
  trustClaudeProject,
  trustCodexProject,
  visibleSessionView,
  worktreeCard,
  type E2eContext,
} from "./helpers";

// Real-provider e2e, parametrized over both providers so each one is exercised
// through the exact same scenarios (create / resume / reuse / promote). Each test
// launches Yuru with an isolated HOME so the spawned CLI writes its session store
// under a throwaway directory, then borrows the real login so the provider is
// genuinely authenticated. Everything created lives under tmpHome / tmpYuru and is
// removed afterward.
//
// A freshly created session has no resumable conversation until its first turn, so
// every scenario drives one real turn and waits until an assistant reply is
// persisted (which proves the borrowed credentials authenticate a real turn).
// Note: the on-screen marker also appears in the typed prompt, so asserting it
// after a restart confirms the conversation was restored, not that the assistant
// produced that exact text.

interface ProviderE2e {
  label: string;
  branchName: string;
  worktreeName: string;
  seedHome(home: string, trustedRepoPath: string): Promise<void>;
  trustProject(home: string, projectPath: string): Promise<void>;
  createExternalSession(home: string, cwd: string, prompt: string): void;
  conversationCount(home: string, cwd: string): number;
  // True once an authenticated turn has persisted an assistant message. The CLIs
  // write a session file at boot before any turn, so this — not file existence —
  // is the signal that the turn actually completed.
  hasAssistantReply(home: string, cwd: string): boolean;
  // Waits until the provider's TUI has finished booting and is ready to accept
  // typed input. Sending keystrokes earlier gets them dropped.
  waitForReady(window: Page): Promise<void>;
}

const providers: ProviderE2e[] = [
  {
    label: "Claude",
    branchName: "feat/session",
    worktreeName: "feat-session",
    seedHome: seedClaudeHome,
    trustProject: trustClaudeProject,
    createExternalSession: createExternalClaudeSession,
    conversationCount: claudeConversationCount,
    hasAssistantReply: claudeHasAssistantReply,
    async waitForReady(window) {
      await window.waitForTimeout(9000);
    },
  },
  {
    label: "Codex",
    branchName: "feat/session",
    worktreeName: "feat-session",
    seedHome: seedCodexHome,
    trustProject: trustCodexProject,
    createExternalSession: createExternalCodexSession,
    conversationCount: (home) => codexConversationCount(home),
    hasAssistantReply: (home) => codexHasAssistantReply(home),
    async waitForReady(window) {
      await expect(visibleSessionView(window).locator(".xterm")).toContainText("OpenAI Codex", {
        timeout: 20_000,
      });
      await window.waitForTimeout(1000);
    },
  },
];

// 新規 worktree は provider によらず .yuru/worktrees に掘られる。
function worktreeDir(repoDir: string, worktreeName: string): string {
  return path.join(repoDir, ".yuru", "worktrees", worktreeName);
}

// active な primary session のドット。aria-label は "active · waiting" のように
// その時々の activity 状態が付くので、前方一致で active であることだけを見る。
function primarySessionActiveDot(window: Page, cardText: string, provider: ProviderE2e) {
  return worktreeCard(window, cardText).locator(
    `[aria-label^="${provider.label} primary session active"]`,
  );
}

// Creates a worktree through the UI, starts a provider session from the
// Terminal's session start surface (creation and session start are separate
// steps), and drives one real turn so the provider persists a resumable
// conversation containing the marker.
async function createSessionWithTurn(
  provider: ProviderE2e,
  context: E2eContext,
  window: Page,
  repoDir: string,
  marker: string,
): Promise<void> {
  await window.locator(".repo-row-new-btn").click();
  await window.locator(".worktree-name-input").fill(provider.branchName);
  await window.locator(".worktree-create-btn").click();
  const sessionView = visibleSessionView(window);
  await sessionView.locator(".new-session-action", { hasText: provider.label }).click();
  await expect(sessionView.locator(".xterm")).toBeVisible({ timeout: 30_000 });

  await provider.waitForReady(window);
  await sessionView.locator(".xterm").click();
  await window.keyboard.type(`Reply with exactly: ${marker}`, { delay: PROMPT_TYPE_DELAY_MS });
  // Give the TUI a moment to ingest the line before submitting, otherwise Enter
  // races the input and the turn is never sent.
  await window.waitForTimeout(1500);
  await window.keyboard.press("Enter");

  // Wait for the turn to actually complete and persist an assistant message. This
  // proves the borrowed credentials authenticate, gives resume a real conversation
  // to restore, and (for codex) outlasts the async primary-session attach.
  try {
    await expect(() => {
      expect(provider.hasAssistantReply(context.tmpHome, repoDir)).toBe(true);
    }).toPass({ timeout: 60_000 });
  } catch (error) {
    // A turn that never lands looks identical from the outside whether the CLI
    // hit a usage limit, never received the prompt, or is still thinking. The
    // terminal says which, so print it before failing.
    const rows = await sessionView.locator(".xterm-rows > div").allInnerTexts();
    console.log(`### TERMINAL AT FAILURE (${provider.label} / ${marker}) ###`);
    console.log(rows.filter((row) => row.trim() !== "").join("\n"));
    console.log("### END ###");
    throw error;
  }
}

for (const provider of providers) {
  test.describe(provider.label, () => {
    test("worktree session を作成すると worktree が掘られ active になる", async () => {
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
        await createSessionWithTurn(provider, context, window, repoDir, "CREATE_OK");

        // Yuru derives the worktree directory from the branch name, mapping
        // slashes to dashes.
        expect(existsSync(worktreeDir(repoDir, provider.worktreeName))).toBe(true);
        await expect(worktreeCard(window, provider.branchName)).toHaveClass(/selected/);
      } finally {
        await closeYuru(app);
        await context.cleanup();
      }
    });

    test("inactive な primary session を resume すると会話が復元され active になる", async () => {
      test.setTimeout(180_000);
      const context = await createE2eContext();
      let app: ElectronApplication | null = null;
      try {
        const repoDir = await createCommittedRepo(context);
        await registerRepo(context, repoDir);
        await provider.seedHome(context.tmpHome, repoDir);

        let launched = await launchWindow(context);
        app = launched.app;
        await createSessionWithTurn(provider, context, launched.window, repoDir, "RESUME_OK");

        // Restart: terminal runtimes are not restored, so the primary turns
        // inactive while its metadata persists.
        await closeYuru(app);
        app = null;
        launched = await launchWindow(context);
        app = launched.app;
        const window = launched.window;

        const card = worktreeCard(window, provider.branchName);
        await expect(
          card.locator(`[aria-label="${provider.label} primary session inactive"]`),
        ).toBeVisible();

        // card クリックは worktree の選択だけ。inactive primary の復元は
        // Terminal の session start surface からの明示操作になる。
        await card.click();
        const sessionView = visibleSessionView(window);
        await expect(sessionView.locator(".terminal-session-start")).toBeVisible();
        await sessionView.locator(".resume-primary-action").click();

        await expect(sessionView.locator(".xterm")).toBeVisible({ timeout: 30_000 });
        await expect(sessionView.locator(".xterm")).toContainText("RESUME_OK", {
          timeout: 30_000,
        });
        await expect(primarySessionActiveDot(window, provider.branchName, provider)).toBeVisible();
      } finally {
        await closeYuru(app);
        await context.cleanup();
      }
    });

    test("active な primary を選び直しても新規 PTY を作らず既存セッションを再利用する", async () => {
      test.setTimeout(180_000);
      const context = await createE2eContext();
      let app: ElectronApplication | null = null;
      try {
        const repoDir = await createCommittedRepo(context);
        await registerRepo(context, repoDir);
        await provider.seedHome(context.tmpHome, repoDir);

        const launched = await launchWindow(context);
        app = launched.app;
        const window = launched.window;
        await createSessionWithTurn(provider, context, window, repoDir, "REUSE_OK");
        const sessionView = visibleSessionView(window);
        await expect(sessionView.locator(".xterm")).toContainText("REUSE_OK", {
          timeout: 30_000,
        });

        // Type a draft into the TUI input box without submitting it. This unsent
        // input lives only in the running PTY's in-memory state; a newly launched
        // (or resumed) PTY would start with an empty input box. It is the one
        // signal that distinguishes "re-attached to the same live PTY" from
        // "spawned a new PTY and resumed the same session".
        await sessionView.locator(".xterm").click();
        await window.keyboard.type("UNSENT_DRAFT_PROBE");
        await expect(sessionView.locator(".xterm")).toContainText("UNSENT_DRAFT_PROBE", {
          timeout: 10_000,
        });

        // Switch away to the main worktree's standalone terminal, then back to the
        // active primary. Re-selecting an active primary must attach to the
        // existing PTY rather than launch a new one.
        await openMainTerminal(window);
        await worktreeCard(window, provider.branchName).click();

        await expect(sessionView.locator(".xterm")).toBeVisible({ timeout: 30_000 });
        // The unsent draft survived, proving the same live PTY was re-attached
        // rather than a fresh one launched, and no second conversation was created.
        await expect(sessionView.locator(".xterm")).toContainText("UNSENT_DRAFT_PROBE", {
          timeout: 30_000,
        });
        expect(provider.conversationCount(context.tmpHome, repoDir)).toBe(1);
      } finally {
        await closeYuru(app);
        await context.cleanup();
      }
    });

    test("Yuru の外で worktree 内に作ったセッションを suggested から promote して復元できる", async () => {
      test.setTimeout(180_000);
      const context = await createE2eContext();
      let app: ElectronApplication | null = null;
      try {
        const repoDir = await createCommittedRepo(context);
        const worktreePath = await createGitWorktree(context, repoDir, "feat-external");
        await provider.seedHome(context.tmpHome, repoDir);
        await provider.trustProject(context.tmpHome, worktreePath);
        // Work done outside Yuru, directly inside the worktree.
        provider.createExternalSession(
          context.tmpHome,
          worktreePath,
          "Reply with exactly: PROMOTE_OK",
        );

        // Register the worktree without a primary, so the external session is only
        // discoverable as a suggested ("existing") session.
        await registerRepo(context, repoDir, [{ worktreePath }]);

        const launched = await launchWindow(context);
        app = launched.app;
        const window = launched.window;

        const card = worktreeCard(window, "feat-external");
        await expect(card).toContainText("1 existing session");
        await card.click();
        const sessionView = visibleSessionView(window);
        await sessionView.locator(".suggested-session-action").first().click();

        // Promoting resumes the session in the worktree where it was created and
        // restores its conversation.
        await expect(sessionView.locator(".xterm")).toContainText("PROMOTE_OK", {
          timeout: 30_000,
        });
        await expect(primarySessionActiveDot(window, "feat-external", provider)).toBeVisible();
      } finally {
        await closeYuru(app);
        await context.cleanup();
      }
    });
  });
}
