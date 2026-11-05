import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { writeFile, rm, open } from "node:fs/promises";
import path from "node:path";
import { createServer } from "node:http";
import {
  closeYuru,
  createCommittedRepo,
  createE2eContext,
  expectPreviewPath,
  git,
  launchWindow,
  openMainTerminal,
  registerRepo,
} from "./helpers";
import { makePdf } from "./pdf-fixture";

const viewerUrl = "chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html";

async function nativeViewer(window: Page) {
  await expect.poll(() => window.frames().some((frame) => frame.url() === viewerUrl)).toBe(true);
  const frame = window.frames().find((candidate) => candidate.url() === viewerUrl)!;
  await expect(frame.locator("pdf-viewer")).toBeVisible();
  await expect(frame.locator("#pageSelector")).toHaveValue("1");
  return frame;
}

for (const entry of ["Files", "Changes", "Search"] as const) {
  test(`${entry} から PDF を内蔵ビューアで開く`, async () => {
    const context = await createE2eContext();
    let app: ElectronApplication | null = null;
    try {
      const repoDir = await createCommittedRepo(context);
      await writeFile(path.join(repoDir, "sample.PDF"), makePdf(2));
      await registerRepo(context, repoDir);
      const launched = await launchWindow(context);
      app = launched.app;
      const window = launched.window;
      await openMainTerminal(window);
      if (entry === "Search") {
        await window.keyboard.press("Meta+P");
        await window.locator(".file-search .text-input").fill("sample.PDF");
        await window.locator(".file-search-row", { hasText: "sample.PDF" }).click();
      } else {
        await window.locator(".panel-tabs .tab", { hasText: entry }).click();
        await window
          .locator(entry === "Files" ? ".file-tree-row" : ".change-item", { hasText: "sample.PDF" })
          .click();
      }
      await expectPreviewPath(window, "sample.PDF");
      const viewer = await nativeViewer(window);
      await expect(viewer.getByText("/ 2", { exact: true })).toBeVisible();
      await expect(window.locator(".pdf-preview-frame")).toHaveCount(1);
      await expect(window.locator(".preview-header .line-stat")).toBeHidden();
      await expect(
        window.getByRole("button", { name: "Binary files cannot be edited" }),
      ).toBeDisabled();
      const pageInput = viewer.locator("#pageSelector");
      await pageInput.fill("2");
      await pageInput.press("Enter");
      await expect(pageInput).toHaveValue("2");
      if (entry === "Files") {
        await window.screenshot({
          path: path.join(context.repoRoot, "test-results/pdf-preview.png"),
        });
      }
    } finally {
      await closeYuru(app);
      await context.cleanup();
    }
  });
}

test("PDF の更新に追従し、削除された PDF は元の版を表示する", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    await writeFile(path.join(repoDir, "live.pdf"), makePdf(1));
    git(["add", "live.pdf"], repoDir);
    git(["commit", "-m", "add pdf"], repoDir);
    await writeFile(path.join(repoDir, "live.pdf"), makePdf(2));
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;
    await openMainTerminal(window);
    await window.locator(".change-item", { hasText: "live.pdf" }).click();
    let viewer = await nativeViewer(window);
    await expect(viewer.getByText("/ 2", { exact: true })).toBeVisible();
    const oldUrl = await window.locator(".pdf-preview-frame").getAttribute("src");
    await writeFile(path.join(repoDir, "live.pdf"), makePdf(3));
    await expect(window.locator(".pdf-preview-frame")).not.toHaveAttribute("src", oldUrl!, {
      timeout: 10_000,
    });
    viewer = await nativeViewer(window);
    await expect(viewer.getByText("/ 3", { exact: true })).toBeVisible();
    await rm(path.join(repoDir, "live.pdf"));
    await expect(window.locator(".pdf-preview-frame")).not.toHaveAttribute("src", oldUrl!, {
      timeout: 10_000,
    });
    await expect
      .poll(
        async () => {
          const frame = window.frames().find((candidate) => candidate.url() === viewerUrl);
          return frame
            ?.getByText("/ 1", { exact: true })
            .isVisible()
            .catch(() => false);
        },
        { timeout: 10_000 },
      )
      .toBe(true);
    await expect(window.locator(".pdf-preview-frame")).toHaveCount(1);
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("PDF のスクリプト・通信・画面遷移を拒否し、表示終了後は読み取り許可を解放する", async () => {
  const context = await createE2eContext();
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.url ?? "");
    response.writeHead(200, { "Access-Control-Allow-Origin": "*" });
    response.end("not reachable from PDF");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Missing test server port");
  }
  const endpoint = `http://127.0.0.1:${address.port}/pdf-request`;
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    await writeFile(path.join(repoDir, "unsafe.pdf"), makePdf(1, endpoint));
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;
    const appUrl = window.url();
    await app.evaluate(({ shell }) => {
      (globalThis as any).__pdfOpened = [];
      shell.openExternal = async (url) => {
        (globalThis as any).__pdfOpened.push(url);
      };
    });
    await openMainTerminal(window);
    await window.locator(".change-item", { hasText: "unsafe.pdf" }).click();
    await nativeViewer(window);
    await expect
      .poll(() =>
        app!.evaluate(({ BrowserWindow }) => {
          const frame = BrowserWindow.getAllWindows()[0].webContents.mainFrame.framesInSubtree.find(
            (frame) =>
              frame.url.startsWith("yuru-pdf:") &&
              frame.parent?.url.startsWith("chrome-extension:"),
          );
          return frame?.executeJavaScript(
            "document.querySelector('embed')?.getAttribute('javascript')",
          );
        }),
      )
      .toBe("block");
    for (const frame of window.frames().filter((frame) => frame !== window.mainFrame())) {
      expect(
        await frame.evaluate(() => ({
          api: typeof (window as any).electronAPI,
          node: typeof (window as any).require,
        })),
      ).toEqual({ api: "undefined", node: "undefined" });
    }
    const source = await window.locator(".pdf-preview-frame").getAttribute("src");
    const nativeFrame = window.frames().find((frame) => frame.url() === viewerUrl)!;
    // trusted なビューアからの試行でも、許可された PDF 以外は main 側で遮断する。
    expect(
      await nativeFrame.evaluate(async (url) => {
        try {
          await fetch(url);
          return "allowed";
        } catch {
          return "blocked";
        }
      }, endpoint),
    ).toBe("blocked");
    // ページ全体が外部リンクの PDF を実際にクリックしても、ブラウザ起動・外部通信を起こさない。
    await window.locator(".pdf-preview-frame").click({ position: { x: 180, y: 180 } });
    await nativeFrame.evaluate(() => {
      window.open("https://example.invalid/pdf-popup");
    });
    await nativeFrame.evaluate(() => {
      location.href = "https://example.invalid/pdf-navigation";
    });
    await expect.poll(() => app!.evaluate(() => (globalThis as any).__pdfOpened)).toEqual([]);
    expect(window.url()).toBe(appUrl);
    expect(nativeFrame.url()).toBe(viewerUrl);
    expect(requests).toEqual([]);
    await window.getByRole("button", { name: "Close code panel" }).click();
    await expect(window.locator(".pdf-preview-frame")).toHaveCount(0);
    expect(
      await app.evaluate(
        async ({ session }, url) => (await session.defaultSession.fetch(url)).status,
        source!,
      ),
    ).toBe(404);
  } finally {
    await closeYuru(app);
    await context.cleanup();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("大きすぎる PDF は読み込む前に理由を表示する", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    const file = await open(path.join(repoDir, "large.pdf"), "w");
    await file.truncate(51 * 1024 * 1024);
    await file.close();
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;
    await openMainTerminal(window);
    await window.locator(".change-item", { hasText: "large.pdf" }).click();
    await expect(
      window.getByText("PDF files larger than 50 MiB cannot be previewed"),
    ).toBeVisible();
    await expect(window.locator(".pdf-preview-frame")).toHaveCount(0);
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});
