import { expect, test, type ElectronApplication } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  closeYuru,
  createCommittedRepo,
  createE2eContext,
  git,
  gitOutput,
  launchWindow,
  readMetadata,
  registerRepo,
  visibleSessionView,
  worktreeCard,
  writeFiles,
} from "./helpers";

test("＋ボタンで Create Worktree モーダルが開き Escape と外側クリックで閉じる", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;

    await window.locator(".repo-row-new-btn").click();
    await expect(window.locator(".repo-picker-header")).toHaveText("Create Worktree");

    const input = window.locator(".worktree-name-input");
    await expect(input).toHaveValue(/^work-\d{4}-\d{6}$/);
    await expect(input).toBeFocused();
    expect(
      await input.evaluate((element) => {
        const inputElement = element as HTMLInputElement;
        return (
          inputElement.selectionStart === 0 &&
          inputElement.selectionEnd === inputElement.value.length
        );
      }),
    ).toBe(true);

    await input.fill("bad branch");
    await expect(window.locator(".worktree-error")).toContainText(
      "Letters, digits, dots, underscores, slashes, dashes only",
    );
    await expect(window.locator(".worktree-create-btn")).toBeDisabled();

    await input.fill("feature/");
    await expect(window.locator(".worktree-create-btn")).toBeDisabled();

    await input.press("Escape");
    await expect(window.locator(".repo-picker")).toBeHidden();

    await window.locator(".repo-row-new-btn").click();
    await expect(window.locator(".repo-picker")).toBeVisible();
    await window.locator(".modal-backdrop").click({ position: { x: 10, y: 10 } });
    await expect(window.locator(".repo-picker")).toBeHidden();
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

// worktree の作成に provider は関与しない。作成した worktree は session なしで
// 選択され、Terminal に session start surface (New Session の選択肢) が出る。
test("provider を選ばず worktree を作成でき、Terminal に session の選択肢が出る", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;

    await window.locator(".repo-row-new-btn").click();
    await window.locator(".worktree-name-input").fill("feature/f43-create");
    await window.locator(".worktree-create-btn").click();

    await expect(window.locator(".repo-picker")).toBeHidden();
    // branch 名の `/` は worktree 名では `-` になり、provider によらず .yuru/worktrees に掘られる。
    expect(existsSync(path.join(repoDir, ".yuru", "worktrees", "feature-f43-create"))).toBe(true);
    await expect(worktreeCard(window, "feature/f43-create")).toHaveClass(/selected/);

    // session はまだ始まっていない: PTY はなく、Terminal に Claude / Codex の選択肢が出る。
    const sessionView = visibleSessionView(window);
    await expect(sessionView.locator(".terminal-session-start")).toBeVisible();
    await expect(sessionView.locator(".new-session-action", { hasText: "Claude" })).toBeVisible();
    await expect(sessionView.locator(".new-session-action", { hasText: "Codex" })).toBeVisible();
    await expect(sessionView.locator(".xterm")).toHaveCount(0);

    // session がなくても右ペイン (Files / Changes) は選択中 worktree に対して使える。
    await expect(window.locator(".changes-panel").filter({ visible: true })).toBeVisible();

    const metadata = await readMetadata(context);
    expect(metadata.taskWorktrees.map((entry) => entry.worktreePath)).toEqual([
      path.join(repoDir, ".yuru", "worktrees", "feature-f43-create"),
    ]);
    expect(metadata.taskWorktrees[0].primarySession).toBeUndefined();
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("既存 branch 名で作成するとエラーを出してモーダルを維持する", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    git(["branch", "already-there"], repoDir);
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;

    await window.locator(".repo-row-new-btn").click();
    await window.locator(".worktree-name-input").fill("already-there");
    await window.locator(".worktree-create-btn").click();

    await expect(window.locator(".repo-picker")).toBeVisible();
    await expect(window.locator(".worktree-error")).toContainText(
      'Branch "already-there" already exists',
    );
    await expect(window.locator(".task-worktree-card", { hasText: "already-there" })).toHaveCount(
      0,
    );
    expect(existsSync(path.join(repoDir, ".yuru", "worktrees", "already-there"))).toBe(false);
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("空の branch 名では Create が無効になる", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;

    await window.locator(".repo-row-new-btn").click();
    await window.locator(".worktree-name-input").fill("   ");

    await expect(window.locator(".worktree-create-btn")).toBeDisabled();
    await expect(window.locator(".worktree-error")).toHaveCount(0);
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

// From origin モード (F42): origin の branch 名をペーストして取り込む第 2 の作成方法。
// origin は local path の Git repo で代用する (fetch の挙動は URL の種類によらない)。
test("From origin モードで remote branch から worktree を作成する", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const remoteDir = await createCommittedRepo(context);
    git(["switch", "-c", "feature/pr-head"], remoteDir);
    await writeFiles(remoteDir, { "pr.txt": "from pr\n" });
    git(["add", "."], remoteDir);
    git(["commit", "-m", "pr work"], remoteDir);

    const repoDir = await createCommittedRepo(context);
    git(["remote", "add", "origin", remoteDir], repoDir);
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;

    await window.locator(".repo-row-new-btn").click();
    await window.locator(".worktree-mode-tab", { hasText: "From origin" }).click();
    const input = window.locator(".worktree-name-input");
    await expect(input).toHaveValue("");
    await input.fill("feature/pr-head");
    await window.locator(".worktree-create-btn").click();

    await expect(window.locator(".repo-picker")).toBeHidden();
    const worktreePath = path.join(repoDir, ".yuru", "worktrees", "feature-pr-head");
    expect(readFileSync(path.join(worktreePath, "pr.txt"), "utf8")).toBe("from pr\n");
    await expect(worktreeCard(window, "feature/pr-head")).toHaveClass(/selected/);

    // local branch は remote と同名で、upstream が origin/<branch> になっている。
    expect(
      gitOutput(["rev-parse", "--abbrev-ref", "feature/pr-head@{upstream}"], worktreePath).trim(),
    ).toBe("origin/feature/pr-head");
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("origin に無い branch を指定するとエラーを出してモーダルを維持する", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const remoteDir = await createCommittedRepo(context);
    const repoDir = await createCommittedRepo(context);
    git(["remote", "add", "origin", remoteDir], repoDir);
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;

    await window.locator(".repo-row-new-btn").click();
    await window.locator(".worktree-mode-tab", { hasText: "From origin" }).click();
    await window.locator(".worktree-name-input").fill("no-such-branch");
    await window.locator(".worktree-create-btn").click();

    await expect(window.locator(".repo-picker")).toBeVisible();
    await expect(window.locator(".worktree-error")).toContainText("no-such-branch");
    expect(existsSync(path.join(repoDir, ".yuru", "worktrees", "no-such-branch"))).toBe(false);
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("worktree directory が既にあるとエラーを出して作成しない", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    const existingWorktreeDir = path.join(repoDir, ".yuru", "worktrees", "directory-exists");
    await mkdir(existingWorktreeDir, { recursive: true });
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;

    await window.locator(".repo-row-new-btn").click();
    await window.locator(".worktree-name-input").fill("directory-exists");
    await window.locator(".worktree-create-btn").click();

    await expect(window.locator(".repo-picker")).toBeVisible();
    await expect(window.locator(".worktree-error")).toContainText(
      'Worktree "directory-exists" already exists',
    );
    await expect(
      window.locator(".task-worktree-card", { hasText: "directory-exists" }),
    ).toHaveCount(0);
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});
