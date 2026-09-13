import { expect, test, type ElectronApplication } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ChildProcess } from "node:child_process";
import { createE2eContext, launchYuru } from "./helpers";

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

for (const shutdown of ["SIGTERM", "repeated quit"] as const) {
  test(`${shutdown} waits for the plan usage process to exit`, async () => {
    const context = await createE2eContext();
    const pidFile = path.join(context.tmpHome, "kimi.pid");
    const kimi = path.join(context.tmpHome, "kimi");
    const shell = path.join(context.tmpHome, "resolve-shell");
    let app: ElectronApplication | null = null;
    let parent: ChildProcess | undefined;
    let childPid: number | undefined;
    try {
      // A usage server that requires the SIGKILL fallback. Install its handler
      // before publishing the PID so shutdown cannot race its initialization.
      await writeFile(
        kimi,
        `#!${process.execPath}\n` +
          `process.on('SIGTERM', () => {});\n` +
          `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));\n` +
          `setInterval(() => {}, 60000);\n`,
        { mode: 0o755 },
      );
      // Resolve only this fake provider, without starting installed CLIs.
      await writeFile(
        shell,
        `#!/bin/sh\nprintf 'env\\tPATH\\t/usr/bin:/bin\\ncmd\\tkimi\\t%s\\nyuru-resolved\\n' '${kimi}'\n`,
        { mode: 0o755 },
      );
      app = await launchYuru(context, { env: { SHELL: shell } });
      parent = app.process();
      await expect.poll(async () => {
        childPid = Number(await readFile(pidFile, "utf8").catch(() => "0"));
        return childPid > 0;
      }).toBe(true);
      const parentPid = parent.pid!;
      if (shutdown === "SIGTERM") {
        parent.kill("SIGTERM");
      } else {
        await app.evaluate(({ app }) => {
          setTimeout(() => {
            app.quit();
            app.quit();
          }, 0);
        });
      }
      // Observing the child at parent exit detects quitting before cleanup.
      await expect.poll(() => isAlive(parentPid)).toBe(false);
      expect(isAlive(childPid!)).toBe(false);
    } finally {
      // Also clean up after the pre-fix failure, where the child is orphaned.
      if (childPid && isAlive(childPid)) process.kill(childPid, "SIGKILL");
      if (parent?.pid && isAlive(parent.pid)) parent.kill("SIGKILL");
      await context.cleanup();
    }
  });
}
