import { expect, test, type ElectronApplication, type Locator, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  closeYuru,
  createCommittedRepo,
  createGitWorktree,
  createE2eContext,
  expectPreviewPath,
  git,
  launchWindow,
  openMainTerminal,
  registerRepo,
  visibleWorktreeView,
  worktreeCard,
} from "./helpers";
import { toWorktreeId } from "../../src/main/worktree-identity";

// 実ブラウザを開かないよう shell.openExternal を記録用スタブに差し替える。
async function stubOpenExternal(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ shell }) => {
    const opened: string[] = [];
    (globalThis as { __openedExternalUrls?: string[] }).__openedExternalUrls = opened;
    shell.openExternal = async (url: string) => {
      opened.push(url);
    };
  });
}

function openedExternalUrls(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(
    () => (globalThis as { __openedExternalUrls?: string[] }).__openedExternalUrls ?? [],
  );
}

function collectDialogs(window: Page): string[] {
  const dialogs: string[] = [];
  window.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  return dialogs;
}

async function clickTerminalRowStart(row: Locator, window: Page): Promise<void> {
  const box = await row.boundingBox();
  if (!box) {
    throw new Error("Terminal row is not visible");
  }
  const x = box.x + 20;
  const y = box.y + box.height / 2;
  // xterm はターミナル外へ出ても最後のセルを覚えていて、同じセルへ一度に戻るとリンクを探し直さない。
  // 別のセルを経由してから目的のセルへ動かす。
  await window.mouse.move(box.x + 2, y);
  await window.mouse.move(x, y);
  await window.mouse.click(x, y);
}

async function createFakeGh(home: string): Promise<string> {
  const binDir = path.join(home, "bin");
  await mkdir(binDir, { recursive: true });
  await writeFile(path.join(binDir, "gh"), '#!/bin/sh\necho "Issue title"\n', { mode: 0o755 });
  return `${binDir}:${process.env.PATH ?? ""}`;
}

test("OSC 8 ハイパーリンクのクリックは確認ダイアログなしで shell.openExternal に流れる", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;
    await stubOpenExternal(app);
    const dialogs = collectDialogs(window);

    await openMainTerminal(window);
    await window.locator(".xterm").click();
    // リンクテキストをシェル変数で組み立て、echo された入力行が出力行と
    // 同じテキストにならないようにする（クリック対象の行を一意にするため）。
    await window.keyboard.type(
      "T=TARGET; printf '\\e]8;;https://example.com/osc8\\aCLICK_OSC8_'\"$T\"'\\e]8;;\\a\\n'",
    );
    await window.keyboard.press("Enter");
    const linkRow = window.locator(".xterm-rows > div", { hasText: "CLICK_OSC8_TARGET" });
    await expect(linkRow).toBeVisible({ timeout: 10_000 });

    // 行の上には xterm のオーバーレイ要素が重なっていて locator.click() は
    // hit-target チェックで進まないため、座標を計算して mouse で直接クリックする。
    // リンクは行頭から始まるので、行の左端付近を狙う。
    const box = await linkRow.boundingBox();
    if (!box) {
      throw new Error("Link row is not visible");
    }
    const x = box.x + 20;
    const y = box.y + box.height / 2;
    await window.mouse.move(x, y);
    await window.mouse.click(x, y);

    await expect.poll(() => openedExternalUrls(app!)).toEqual(["https://example.com/osc8"]);
    expect(dialogs).toEqual([]);
    expect(app.windows()).toHaveLength(1);
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("standalone terminal の URL は Bookmarks に追加されない", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;

    await openMainTerminal(window);
    await window.locator(".xterm").click();
    await window.keyboard.type("H=http; printf '%s://127.0.0.1:1/from-terminal\\n' \"$H\"");
    await window.keyboard.press("Enter");
    await expect(
      window.locator(".xterm-rows > div", {
        hasText: "http://127.0.0.1:1/from-terminal",
      }),
    ).toBeVisible({ timeout: 10_000 });

    await window.locator(".panel-tabs .tab", { hasText: "Bookmarks" }).click();
    await expect(window.getByText("No bookmarks", { exact: true })).toBeVisible();
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("ターミナルで URL リンクをクリックすると Bookmarks に登録される", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;
    await stubOpenExternal(app);

    await openMainTerminal(window);
    await window.locator(".xterm").click();
    // リンクテキストをシェル変数で組み立て、echo された入力行が出力行と
    // 同じテキストにならないようにする（クリック対象の行を一意にするため）。
    await window.keyboard.type("H=http; printf '%s://example.com/clicked\\n' \"$H\"");
    await window.keyboard.press("Enter");
    const linkRow = window.locator(".xterm-rows > div", {
      hasText: "http://example.com/clicked",
    });
    await expect(linkRow).toBeVisible({ timeout: 10_000 });

    // 行の上には xterm のオーバーレイ要素が重なっていて locator.click() は
    // hit-target チェックで進まないため、座標を計算して mouse で直接クリックする。
    // リンクは行頭から始まるので、行の左端付近を狙う。
    const box = await linkRow.boundingBox();
    if (!box) {
      throw new Error("Link row is not visible");
    }
    const x = box.x + 20;
    const y = box.y + box.height / 2;
    await window.mouse.move(x, y);
    await window.mouse.click(x, y);

    await expect.poll(() => openedExternalUrls(app!)).toEqual(["http://example.com/clicked"]);
    await window.locator(".panel-tabs .tab", { hasText: "Bookmarks" }).click();
    await expect(window.locator(".bookmark-row")).toHaveCount(1);
    await expect(window.locator(".bookmarks-pane")).toContainText("http://example.com/clicked");
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("ターミナルで #番号をクリックすると現在の GitHub Issue / PR を開いて Bookmarks に登録する", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    git(["remote", "add", "origin", "https://github.com/jinjor/yuru.git"], repoDir);
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context, {
      env: { PATH: await createFakeGh(context.tmpHome) },
    });
    app = launched.app;
    const window = launched.window;
    await stubOpenExternal(app);

    await openMainTerminal(window);
    await window.locator(".xterm").click();
    await window.keyboard.type("N=75; printf '#%s\\n' \"$N\"");
    await window.keyboard.press("Enter");
    const referenceRow = window.locator(".xterm-rows > div", { hasText: "#75" });
    await expect(referenceRow).toBeVisible({ timeout: 10_000 });

    await clickTerminalRowStart(referenceRow, window);

    const expectedUrl = "https://github.com/jinjor/yuru/pull/75";
    await expect.poll(() => openedExternalUrls(app!)).toEqual([expectedUrl]);
    await window.locator(".panel-tabs .tab", { hasText: "Bookmarks" }).click();
    const bookmark = window.locator(".bookmark-row", { hasText: expectedUrl });
    await expect(bookmark).toHaveCount(1);
    await expect(bookmark).toContainText("Issue title");
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("Terminal ヘッダの PR をクリックすると Bookmarks に登録する", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    const worktreePath = await createGitWorktree(context, repoDir, "bookmark-pr");
    const repoId = await registerRepo(context, repoDir, [{ worktreePath }]);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;
    await stubOpenExternal(app);
    await worktreeCard(window, "bookmark-pr").click();

    const pullRequestUrl = "http://127.0.0.1:1/pull/74";
    const pushedDetail = await window.evaluate(
      async ({ worktreeId, url }) => ({
        ...(await window.electronAPI.getWorktreeDetail(worktreeId)),
        githubPullRequest: {
          kind: "pr" as const,
          number: 74,
          state: "open" as const,
          isApproved: false,
          url,
        },
      }),
      { worktreeId: toWorktreeId(repoId, worktreePath), url: pullRequestUrl },
    );
    await app.evaluate(({ BrowserWindow }, detail) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send("worktree:detailChanged", detail);
    }, pushedDetail);

    const sessionView = visibleWorktreeView(window);
    const pullRequestBadge = sessionView.locator(".github-badge", { hasText: "Open #74" });
    await expect(pullRequestBadge).toBeVisible();
    await pullRequestBadge.click();

    await expect.poll(() => openedExternalUrls(app!)).toEqual([pullRequestUrl]);
    await sessionView.locator(".panel-tabs .tab", { hasText: "Bookmarks" }).click();
    await expect(sessionView.locator(".bookmark-row", { hasText: pullRequestUrl })).toHaveCount(1);
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("TUI が文中から複数行に描画したファイルパスの先頭行からプレビューできる", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const filePath = `src/${"nested_".repeat(25)}terminal_link_target.ts`;
    const repoDir = await createCommittedRepo(context, {
      [filePath]: "export const wrappedLinkTarget = true;\n",
    });
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;

    await openMainTerminal(window);
    await window.locator(".xterm").click();
    await window.keyboard.type(
      `P=${filePath}; W=$((COLUMNS/2)); W1=$((W-5)); WN=$((W-2)); printf 'open %s\\n' "\${P:0:$W1}"; R="\${P:$W1}"; while (( \${#R} > WN )); do printf '  %s\\n' "\${R:0:$WN}"; R="\${R:$WN}"; done; printf '  %s\\n' "$R"`,
    );
    await window.keyboard.press("Enter");

    const linkRow = window.locator(".xterm-rows > div", { hasText: "open src/" }).last();
    await expect(linkRow).toBeVisible({ timeout: 10_000 });
    const box = await linkRow.boundingBox();
    if (!box) {
      throw new Error("Wrapped file link row is not visible");
    }
    const x = box.x + 60;
    const y = box.y + box.height / 2;
    await window.mouse.move(x, y);
    await expect(window.locator(".xterm-screen")).toHaveClass(/xterm-cursor-pointer/);
    await window.mouse.click(x, y);

    await expectPreviewPath(window, filePath);
    await expect(window.locator(".source-viewer")).toContainText("wrappedLinkTarget");
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("ターミナルのディレクトリパスをクリックすると Files でそのディレクトリを開く", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context, {
      "src/nested/target/leaf.ts": "export const leaf = true;\n",
    });
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;

    await openMainTerminal(window);
    const sessionView = visibleWorktreeView(window);
    const filesTab = sessionView.locator(".panel-tabs .tab", { hasText: "Files" });
    const treeRow = (path: string) => sessionView.locator(`.file-tree-row[data-path="${path}"]`);
    await window.locator(".xterm").click();

    // 相対パスは末尾の `/` でディレクトリと分かる形にする。echo された入力行と出力行が
    // 同じテキストにならないよう、printf で組み立てる。
    await window.keyboard.type("printf '%s/target/\\n' src/nested");
    await window.keyboard.press("Enter");
    const relativeRow = window.locator(".xterm-rows > div", { hasText: "src/nested/target/" });
    await expect(relativeRow).toBeVisible({ timeout: 10_000 });
    await clickTerminalRowStart(relativeRow, window);

    await expect(filesTab).toHaveClass(/selected/);
    await expect(treeRow("src/nested/target")).toBeVisible();
    await expect(treeRow("src/nested/target/leaf.ts")).toBeVisible();

    // Files を開いたまま、畳んだ同じディレクトリをもう一度開く。
    await treeRow("src/nested/target").click();
    await expect(treeRow("src/nested/target/leaf.ts")).toHaveCount(0);
    await clickTerminalRowStart(relativeRow, window);
    await expect(treeRow("src/nested/target/leaf.ts")).toBeVisible();

    // worktree 内の絶対パス。
    await sessionView.getByTitle("Collapse all directories").click();
    await sessionView.locator(".panel-tabs .tab", { hasText: "Changes" }).click();
    await window.locator(".xterm").click();
    await window.keyboard.type("printf '%s/src/nested\\n' \"$PWD\"");
    await window.keyboard.press("Enter");
    const absoluteRow = window.locator(".xterm-rows > div", { hasText: `${repoDir}/src/nested` });
    await expect(absoluteRow).toBeVisible({ timeout: 10_000 });
    await clickTerminalRowStart(absoluteRow, window);

    await expect(filesTab).toHaveClass(/selected/);
    await expect(treeRow("src/nested/target")).toBeVisible();
    await expect(treeRow("src/nested/target/leaf.ts")).toHaveCount(0);
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("renderer の window.open は Electron の子ウインドウを開かず既定ブラウザに流れる", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;
    await stubOpenExternal(app);

    await window.evaluate(() => {
      window.open("https://example.com/window-open");
    });

    await expect.poll(() => openedExternalUrls(app!)).toEqual(["https://example.com/window-open"]);
    expect(app.windows()).toHaveLength(1);
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});
