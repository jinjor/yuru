import { _electron as electron, expect, test, type ElectronApplication } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

// Real-provider e2e: launches Yuru with an isolated HOME so the spawned Claude
// CLI writes its session store under a throwaway directory, then borrows the
// real login credentials from the macOS Keychain so the provider is genuinely
// authenticated. Everything created during the test lives under tmpHome / tmpYuru
// and is removed afterward.

function git(args: string[], cwd: string): void {
  const env = { ...process.env };
  delete env.GIT_DIR;
  execFileSync("git", args, { cwd, env, stdio: "ignore" });
}

// A pristine HOME has no Claude login, no completed onboarding, and no trusted
// directories, so an interactive `claude` would block on those prompts instead
// of registering a session. We seed the real credentials (from the Keychain) and
// mark onboarding done plus the repo as trusted. The trust key must be the repo's
// realpath because Claude resolves its cwd (e.g. /tmp -> /private/tmp on macOS).
async function seedClaudeHome(home: string, trustedRepoPath: string): Promise<void> {
  const credentials = execFileSync(
    "security",
    ["find-generic-password", "-s", "Claude Code-credentials", "-w"],
    { encoding: "utf8" },
  );
  const claudeDir = path.join(home, ".claude");
  await mkdir(claudeDir, { recursive: true });
  await writeFile(path.join(claudeDir, ".credentials.json"), credentials, { mode: 0o600 });
  await writeFile(
    path.join(home, ".claude.json"),
    JSON.stringify({
      hasCompletedOnboarding: true,
      projects: {
        [trustedRepoPath]: { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true },
      },
    }),
  );
}

test("creates a worktree session with the real Claude provider", async () => {
  const repoRoot = process.cwd();
  const tmpHome = await mkdtemp(path.join(tmpdir(), "yuru-e2e-home-"));
  const tmpYuru = await mkdtemp(path.join(tmpdir(), "yuru-e2e-yuru-"));
  // realpath: Claude resolves its cwd, so the repo path used for the trust key
  // and the path Yuru records must match what Claude sees.
  const repoDir = realpathSync(await mkdtemp(path.join(tmpdir(), "yuru-e2e-repo-")));

  // A throwaway Git repo with one commit so `git worktree add` has a HEAD.
  git(["init", "-b", "main"], repoDir);
  git(["config", "user.email", "e2e@example.com"], repoDir);
  git(["config", "user.name", "E2E"], repoDir);
  await writeFile(path.join(repoDir, "README.md"), "# e2e\n");
  git(["add", "."], repoDir);
  git(["commit", "-m", "init"], repoDir);

  // Register the repo in Yuru metadata so it shows up in the left sidebar.
  await writeFile(
    path.join(tmpYuru, "metadata.json"),
    `${JSON.stringify({ repos: [{ id: randomUUID(), repoPath: repoDir }], taskWorktrees: [] }, null, 2)}\n`,
  );

  await seedClaudeHome(tmpHome, repoDir);

  let app: ElectronApplication | null = null;
  try {
    app = await electron.launch({
      args: [repoRoot],
      cwd: repoRoot,
      env: {
        ...process.env,
        HOME: tmpHome,
        YURU_HOME: tmpYuru,
      },
    });
    const window = await app.firstWindow();

    // The registered repo row carries a "+" button to start a new worktree session.
    await window.locator(".repo-row-new-btn").click();

    // Fill the branch name and create with the Claude provider (first/default).
    const branchName = "e2e-claude";
    await window.locator(".worktree-name-input").fill(branchName);
    await window.locator(".provider-picker-btn", { hasText: "Claude" }).click();
    await window.locator(".worktree-create-btn").click();

    // Yuru creates the Git worktree as part of the session-creation flow.
    const worktreePath = path.join(repoDir, ".claude", "worktrees", branchName);
    await expect(() => {
      expect(existsSync(worktreePath)).toBe(true);
    }).toPass({ timeout: 15_000 });

    // A terminal runtime (the real Claude CLI in a PTY) becomes active.
    await expect(window.locator(".xterm")).toBeVisible({ timeout: 15_000 });
  } finally {
    await app?.close();
    await rm(tmpHome, { recursive: true, force: true });
    await rm(tmpYuru, { recursive: true, force: true });
    await rm(repoDir, { recursive: true, force: true });
  }
});
