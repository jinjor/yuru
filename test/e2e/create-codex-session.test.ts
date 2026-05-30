import { _electron as electron, expect, test, type ElectronApplication } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, realpathSync } from "node:fs";
import { copyFile, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

// Real-provider e2e: launches Yuru with an isolated HOME so the spawned Codex
// CLI writes its session store under a throwaway directory, then borrows the
// real login from ~/.codex/auth.json so the provider is genuinely authenticated.
// Everything created during the test lives under tmpHome / tmpYuru and is removed
// afterward.

function git(args: string[], cwd: string): void {
  const env = { ...process.env };
  delete env.GIT_DIR;
  execFileSync("git", args, { cwd, env, stdio: "ignore" });
}

// A pristine HOME has no Codex login and no trusted directories, so an interactive
// `codex` would block on the "trust this directory?" prompt before accepting input.
// We copy the real credentials file and pre-trust the repo. The trust key must be
// the repo's realpath because Codex resolves its cwd (e.g. /tmp -> /private/tmp).
async function seedCodexHome(home: string, trustedRepoPath: string): Promise<void> {
  const codexDir = path.join(home, ".codex");
  await mkdir(codexDir, { recursive: true });
  await copyFile(path.join(homedir(), ".codex", "auth.json"), path.join(codexDir, "auth.json"));
  await writeFile(
    path.join(codexDir, "config.toml"),
    `[projects.${JSON.stringify(trustedRepoPath)}]\ntrust_level = "trusted"\n`,
  );
}

test("creates a worktree session with the real Codex provider", async () => {
  test.setTimeout(60_000);
  const repoRoot = process.cwd();
  const tmpHome = await mkdtemp(path.join(tmpdir(), "yuru-e2e-home-"));
  const tmpYuru = await mkdtemp(path.join(tmpdir(), "yuru-e2e-yuru-"));
  // realpath so the path Yuru records matches what the CLI resolves its cwd to.
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

  await seedCodexHome(tmpHome, repoDir);

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

    // Fill the branch name and create with the Codex provider.
    const branchName = "e2e-codex";
    await window.locator(".worktree-name-input").fill(branchName);
    await window.locator(".provider-picker-btn", { hasText: "Codex" }).click();
    await window.locator(".worktree-create-btn").click();

    // Yuru creates the Git worktree as part of the session-creation flow.
    const worktreePath = path.join(repoDir, ".yuru", "worktrees", branchName);
    await expect(() => {
      expect(existsSync(worktreePath)).toBe(true);
    }).toPass({ timeout: 15_000 });

    // A terminal runtime (the real Codex CLI in a PTY) becomes active.
    await expect(window.locator(".xterm")).toBeVisible({ timeout: 15_000 });

    // Codex only persists a session once it runs its first turn, so drive one
    // real turn through the terminal and assert a session file lands in the
    // isolated store. This proves the borrowed credentials actually authenticate.
    // Wait for the Codex TUI to finish booting before typing, otherwise the
    // keystrokes are sent before its input is ready and get dropped.
    await expect(window.locator(".xterm")).toContainText("OpenAI Codex", { timeout: 20_000 });
    await window.locator(".xterm").click();
    await window.keyboard.type("Reply with exactly: AUTH_OK");
    // Give the Codex TUI a moment to ingest the typed line before submitting,
    // otherwise the Enter races the input and the turn is never sent.
    await window.waitForTimeout(1500);
    await window.keyboard.press("Enter");

    const codexSessionsDir = path.join(tmpHome, ".codex", "sessions");
    await expect(() => {
      const hasSessionFile =
        existsSync(codexSessionsDir) &&
        readdirSync(codexSessionsDir, { recursive: true }).some(
          (entry) => typeof entry === "string" && entry.endsWith(".jsonl"),
        );
      expect(hasSessionFile).toBe(true);
    }).toPass({ timeout: 30_000 });
  } finally {
    await app?.close();
    await rm(tmpHome, { recursive: true, force: true });
    await rm(tmpYuru, { recursive: true, force: true });
    await rm(repoDir, { recursive: true, force: true });
  }
});
