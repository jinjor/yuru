import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

test("app launches and shows main window", async () => {
  const repoRoot = process.cwd();
  const yuruHome = await mkdtemp(path.join(tmpdir(), "yuru-e2e-"));
  const app = await electron.launch({
    args: [repoRoot],
    cwd: repoRoot,
    env: {
      ...process.env,
      YURU_HOME: yuruHome,
    },
  });
  try {
    const window = await app.firstWindow();
    await expect(window).toHaveTitle("Yuru");
  } finally {
    await app.close();
    await rm(yuruHome, { recursive: true, force: true });
  }
});
