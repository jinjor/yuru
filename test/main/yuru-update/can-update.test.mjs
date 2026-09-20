import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { canUpdateYuru } from "../../../src/main/yuru-update/can-update.ts";

function createInstallation(t, { withManagedRepo = true } = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "yuru-can-update-"));
  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.YURU_APPLICATIONS_DIR;
    delete process.env.YURU_REPO_DIR;
  });

  const applicationsDir = path.join(tempDir, "Applications");
  const repoDir = path.join(tempDir, "repo");
  fs.mkdirSync(applicationsDir, { recursive: true });
  if (withManagedRepo) {
    fs.mkdirSync(path.join(repoDir, ".git"), { recursive: true });
  }
  process.env.YURU_APPLICATIONS_DIR = applicationsDir;
  process.env.YURU_REPO_DIR = repoDir;

  return {
    installedAppPath: path.join(applicationsDir, "Yuru.app", "Contents", "Resources", "app"),
    tempDir,
  };
}

test("インストール済みの Yuru.app 自身なら更新できる", (t) => {
  const { installedAppPath } = createInstallation(t);

  assert.deepEqual(
    canUpdateYuru({ platform: "darwin", packaged: true, appPath: installedAppPath }),
    { ok: true },
  );
});

test("開発版 (packaged でない) では更新できない", (t) => {
  const { installedAppPath } = createInstallation(t);

  const canUpdate = canUpdateYuru({
    platform: "darwin",
    packaged: false,
    appPath: installedAppPath,
  });

  assert.equal(canUpdate.ok, false);
  assert.match(canUpdate.reason, /development build/);
});

test("別の場所に置いた app では更新できない", (t) => {
  const { tempDir } = createInstallation(t);

  const canUpdate = canUpdateYuru({
    platform: "darwin",
    packaged: true,
    appPath: path.join(tempDir, "elsewhere", "Yuru.app", "Contents", "Resources", "app"),
  });

  assert.equal(canUpdate.ok, false);
});

test("managed checkout が無ければ更新できない", (t) => {
  const { installedAppPath } = createInstallation(t, { withManagedRepo: false });

  const canUpdate = canUpdateYuru({
    platform: "darwin",
    packaged: true,
    appPath: installedAppPath,
  });

  assert.equal(canUpdate.ok, false);
});

test("macOS 以外では更新できない", (t) => {
  const { installedAppPath } = createInstallation(t);

  const canUpdate = canUpdateYuru({
    platform: "linux",
    packaged: true,
    appPath: installedAppPath,
  });

  assert.equal(canUpdate.ok, false);
});
