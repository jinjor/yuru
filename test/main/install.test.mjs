import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const installPath = path.resolve("install.sh");
const wrapperSourcePath = path.resolve("bin/yuru");

function writeExecutable(filePath, contents) {
  fs.writeFileSync(filePath, contents);
  fs.chmodSync(filePath, 0o755);
}

function runInstall(t, { shell = "/bin/zsh", yuruBinOnPath = false } = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "yuru-install-"));
  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const homeDir = path.join(tempDir, "home");
  const yuruHome = path.join(homeDir, ".yuru");
  const repoDir = path.join(yuruHome, "repo");
  const yuruBinDir = path.join(yuruHome, "bin");
  const commandBinDir = path.join(tempDir, "commands");
  fs.mkdirSync(path.join(repoDir, ".git"), { recursive: true });
  fs.mkdirSync(commandBinDir);

  writeExecutable(
    path.join(commandBinDir, "git"),
    `#!/bin/sh
case "$*" in
  *"remote get-url origin"*) printf 'https://github.com/jinjor/yuru.git\n' ;;
esac
`,
  );
  writeExecutable(path.join(commandBinDir, "node"), "#!/bin/sh\n");
  writeExecutable(path.join(commandBinDir, "npm"), "#!/bin/sh\n");

  const pathEntries = [commandBinDir, "/usr/bin", "/bin"];
  if (yuruBinOnPath) {
    pathEntries.unshift(yuruBinDir);
  }

  const result = spawnSync("/bin/bash", [installPath], {
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: homeDir,
      PATH: pathEntries.join(":"),
      SHELL: shell,
      YURU_APPLICATIONS_DIR: path.join(homeDir, "Applications"),
      YURU_HOME: yuruHome,
      YURU_REPO_DIR: repoDir,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(result.status, 0, result.stderr);

  return {
    homeDir,
    output: result.stdout,
    stderr: result.stderr,
    wrapperPath: path.join(yuruBinDir, "yuru"),
  };
}

test("install.sh installs the launcher at ~/.yuru/bin and prints zsh PATH setup", (t) => {
  const { homeDir, output, wrapperPath } = runInstall(t);

  assert.equal(fs.readFileSync(wrapperPath, "utf8"), fs.readFileSync(wrapperSourcePath, "utf8"));
  assert.equal(fs.statSync(wrapperPath).mode & 0o777, 0o755);
  assert.equal(fs.existsSync(path.join(homeDir, ".zshrc")), false);
  assert.match(output, /Installed yuru to .*\/\.yuru\/bin\/yuru/);
  assert.match(output, /Copy and run these commands/);
  assert.match(
    output,
    /printf '\\nexport PATH="\$HOME\/\.yuru\/bin:\$PATH"\\n' >> "\$HOME\/\.zshrc"/,
  );
  assert.match(output, /source "\$HOME\/\.zshrc"\n  yuru latest/);
});

test("install.sh skips shell-specific setup when ~/.yuru/bin is already on PATH", (t) => {
  const { output } = runInstall(t, { yuruBinOnPath: true });

  assert.doesNotMatch(output, /Copy and run these commands/);
  assert.match(output, /Next: run 'yuru latest'/);
});

test("install.sh only prints .zshrc setup for zsh", (t) => {
  const { output, stderr } = runInstall(t, { shell: "/bin/fish" });

  assert.doesNotMatch(output, /\.zshrc/);
  assert.doesNotMatch(output, /Copy and run these commands/);
  assert.match(stderr, /PATH setup is not supported yet for shell: \/bin\/fish/);
});
