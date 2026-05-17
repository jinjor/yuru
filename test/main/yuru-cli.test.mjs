import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const cliPath = path.resolve("scripts/yuru-cli.mjs");

function read(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    env: cleanGitEnv(process.env),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function cleanGitEnv(env) {
  const next = { ...env };
  delete next.GIT_DIR;
  return next;
}

test("yuru add registers the current Git repository once", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "yuru-cli-"));
  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const repoDir = path.join(tempDir, "repo");
  const nestedDir = path.join(repoDir, "src");
  const yuruHome = path.join(tempDir, "home");
  fs.mkdirSync(nestedDir, { recursive: true });
  execFileSync("git", ["init"], {
    cwd: repoDir,
    env: cleanGitEnv(process.env),
    stdio: "ignore",
  });

  const env = {
    ...process.env,
    GIT_DIR: "/nonexistent-yuru-test-git-dir",
    YURU_HOME: yuruHome,
  };
  const firstOutput = execFileSync(process.execPath, [cliPath, "add"], {
    cwd: nestedDir,
    env,
    encoding: "utf8",
  });
  const secondOutput = execFileSync(process.execPath, [cliPath, "add"], {
    cwd: repoDir,
    env,
    encoding: "utf8",
  });

  const metadataPath = path.join(yuruHome, "metadata.json");
  const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  const repoRoot = read("git", ["rev-parse", "--show-toplevel"], repoDir);

  assert.match(firstOutput, /^Added: /);
  assert.match(secondOutput, /^Already added: /);
  assert.equal(metadata.repos.length, 1);
  assert.equal(metadata.repos[0].repoPath, repoRoot);
  assert.equal(typeof metadata.repos[0].id, "string");
});
