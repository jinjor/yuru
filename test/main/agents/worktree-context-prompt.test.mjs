import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const previousYuruHome = process.env.YURU_HOME;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "yuru-worktree-context-test-"));
process.env.YURU_HOME = tempDir;

const { loadWorktreeContextPrompt, worktreeContextPromptPath } = await import(
  "../../../src/main/agents/worktree-context-prompt.ts"
);

const context = {
  branchName: "feature-link",
  repoPath: "/repo",
  worktreeName: "feature-link",
  worktreePath: "/repo/.yuru/worktrees/feature-link",
};

test.afterEach(() => fs.rmSync(worktreeContextPromptPath(), { force: true }));

test.after(() => {
  if (previousYuruHome === undefined) {
    delete process.env.YURU_HOME;
  } else {
    process.env.YURU_HOME = previousYuruHome;
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("default worktree context は GitHub Issue / PR の表記を指示する", async () => {
  const prompt = await loadWorktreeContextPrompt(context);

  assert.match(prompt, /Use \/repo\/\.yuru\/worktrees\/feature-link as the working directory/);
  assert.match(prompt, /use either its full URL or `#123` for this repository/);
  assert.match(prompt, /`owner\/repository#123` for another repository/);
});

test("GitHub Issue / PR の表記は custom worktree context にも付加する", async () => {
  fs.writeFileSync(worktreeContextPromptPath(), "Custom context for {branchName}.\n");

  assert.equal(
    await loadWorktreeContextPrompt(context),
    "Custom context for feature-link. When referring to a GitHub issue or pull request, use either its full URL or `#123` for this repository and `owner/repository#123` for another repository.",
  );
});
