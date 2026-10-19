import { expect, test, type ElectronApplication } from "@playwright/test";
import {
  closeYuru,
  createCommittedRepo,
  createE2eContext,
  expectPreviewPath,
  git,
  launchWindow,
  openMainTerminal,
  registerRepo,
  visibleWorktreeView,
  writeFiles,
} from "./helpers";

test("閲覧モードで行をクリックすると行末に blame が出て、ホバーでコミットの詳細が開く", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context, {
      "src/app.ts": "export const one = 1;\nexport const two = 2;\n",
    });
    // コミットしていない行を足しておく
    await writeFiles(repoDir, {
      "src/app.ts": "export const one = 1;\nexport const two = 2;\nexport const three = 3;\n",
    });
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;
    await openMainTerminal(window);
    const sessionView = visibleWorktreeView(window);

    await sessionView.locator(".panel-tabs .tab", { hasText: "Files" }).click();
    await sessionView.locator(".file-tree-row", { hasText: "src" }).click();
    await sessionView.locator(".file-tree-row", { hasText: "app.ts" }).click();
    await expectPreviewPath(window, "src/app.ts");

    // 行を開いただけでは blame は出ない
    const annotation = sessionView.locator(".blame-annotation");
    await expect(annotation).toHaveCount(0);

    await sessionView.locator('.source-line[data-line="2"]').click();
    await expect(sessionView.locator('.source-line[data-line="2"] .blame-annotation')).toContainText(
      "E2E, now • init",
    );

    await annotation.hover();
    const card = window.locator(".blame-card");
    await expect(card).toBeVisible();
    await expect(card.locator(".blame-card-message")).toHaveText("init");

    // ポインタが注記からもカードからも離れたら閉じる
    await window.mouse.move(0, 0);
    await expect(card).toHaveCount(0);

    await sessionView.locator('.source-line[data-line="3"] .source-code').click();
    await expect(sessionView.locator('.source-line[data-line="3"] .blame-annotation')).toHaveText(
      "Not committed yet",
    );
    await expect(annotation).toHaveCount(1);
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("クリックした場所に注記が出ても、マウスを動かすまでカードは開かない", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context, {
      "src/app.ts": "export const one = 1;\nexport const two = 2;\n",
    });
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;
    await openMainTerminal(window);
    const sessionView = visibleWorktreeView(window);

    await sessionView.locator(".panel-tabs .tab", { hasText: "Files" }).click();
    await sessionView.locator(".file-tree-row", { hasText: "src" }).click();
    await sessionView.locator(".file-tree-row", { hasText: "app.ts" }).click();
    await expectPreviewPath(window, "src/app.ts");

    // 1 行目と 2 行目は同じ長さなので、2 行目の注記は 1 行目の注記の真下に出る。
    await sessionView.locator('.source-line[data-line="1"] .source-code').click();
    const firstAnnotation = sessionView.locator('.source-line[data-line="1"] .blame-annotation');
    await expect(firstAnnotation).toContainText("init");
    const annotationBox = await firstAnnotation.boundingBox();
    const secondLineBox = await sessionView.locator('.source-line[data-line="2"]').boundingBox();
    if (!annotationBox || !secondLineBox) {
      throw new Error("line is not visible");
    }
    const x = annotationBox.x + annotationBox.width / 2;
    const y = secondLineBox.y + secondLineBox.height / 2;
    await window.mouse.click(x, y);
    await expect(sessionView.locator('.source-line[data-line="2"] .blame-annotation')).toContainText(
      "init",
    );

    const card = window.locator(".blame-card");
    await window.waitForTimeout(1000);
    await expect(card).toHaveCount(0);

    await window.mouse.move(x + 1, y);
    await expect(card).toBeVisible();
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("注記が行に入りきらなくても、行は折り返さず右端で切れる", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context, { "src/app.ts": "export const one = 1;\n" });
    // 注記がパネルの幅に入りきらないよう、長いメッセージで作り直す。
    git(["commit", "--amend", "-m", "long message ".repeat(30).trim()], repoDir);
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;
    await openMainTerminal(window);
    const sessionView = visibleWorktreeView(window);

    await sessionView.locator(".panel-tabs .tab", { hasText: "Files" }).click();
    await sessionView.locator(".file-tree-row", { hasText: "src" }).click();
    await sessionView.locator(".file-tree-row", { hasText: "app.ts" }).click();
    await expectPreviewPath(window, "src/app.ts");

    const line = sessionView.locator('.source-line[data-line="1"]');
    const heightBefore = (await line.boundingBox())?.height;
    await line.locator(".source-code").click();
    await expect(line.locator(".blame-annotation")).toContainText("long message");

    expect((await line.boundingBox())?.height).toBe(heightBefore);
    const viewer = sessionView.locator(".source-viewer");
    expect(await viewer.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("ファイルの中身を変えずに commit を作り直すと、blame を取り直す", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context, { "src/app.ts": "export const one = 1;\n" });
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;
    await openMainTerminal(window);
    const sessionView = visibleWorktreeView(window);

    await sessionView.locator(".panel-tabs .tab", { hasText: "Files" }).click();
    await sessionView.locator(".file-tree-row", { hasText: "src" }).click();
    await sessionView.locator(".file-tree-row", { hasText: "app.ts" }).click();
    await expectPreviewPath(window, "src/app.ts");

    const annotation = sessionView.locator('.source-line[data-line="1"] .blame-annotation');
    await sessionView.locator('.source-line[data-line="1"]').click();
    await expect(annotation).toContainText("init");

    // 中身もファイルの git の状態も変わらず、HEAD だけが動く。
    git(["commit", "--amend", "-m", "amended"], repoDir);
    await expect(annotation).toContainText("amended", { timeout: 10_000 });
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("行指定で開くとその行の blame が出て、別の行をクリックしても強調表示は動かない", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context, {
      "src/app.ts": "export const first = 1;\nexport const searchNeedle = 'YURU_NEEDLE';\n",
    });
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;
    await openMainTerminal(window);
    const sessionView = visibleWorktreeView(window);

    await window.keyboard.press("Meta+Shift+F");
    await window.locator(".code-search-input-wrap .text-input").fill("YURU_NEEDLE");
    await window.locator(".code-search-match-row").click();
    await expectPreviewPath(window, "src/app.ts");

    const highlighted = sessionView.locator(".source-line.highlight");
    await expect(highlighted).toHaveAttribute("data-line", "2");
    await expect(highlighted.locator(".blame-annotation")).toContainText("init");

    await sessionView.locator('.source-line[data-line="1"]').click();
    await expect(sessionView.locator('.source-line[data-line="1"] .blame-annotation')).toContainText(
      "init",
    );
    await expect(highlighted).toHaveAttribute("data-line", "2");
    await expect(highlighted.locator(".blame-annotation")).toHaveCount(0);
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});
