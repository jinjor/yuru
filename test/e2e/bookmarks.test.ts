import { expect, test, type ElectronApplication, type Locator, type Page } from "@playwright/test";
import { readdir } from "node:fs/promises";
import path from "node:path";
import {
  closeYuru,
  createCommittedRepo,
  createE2eContext,
  launchWindow,
  openMainTerminal,
  registerRepo,
  visibleWorktreeView,
} from "./helpers";

// 1x1 の PNG。中身は問わないので最小のものを使う。
const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function openBookmarks(window: Page) {
  await window.locator(".panel-tabs .tab", { hasText: "Bookmarks" }).click();
  return visibleWorktreeView(window).locator(".bookmarks-pane");
}

// 実際のクリップボードは使えないので、画像 1 件を持つ paste イベントを入力欄へ送る。
// 実際の貼り付けと同じく、フォーカスされた入力欄が起点になる。
async function pasteImage(pane: Locator): Promise<void> {
  const input = pane.locator(".bookmark-compose .text-input");
  await input.focus();
  await input.evaluate(async (element, dataUrl) => {
    const blob = await (await fetch(dataUrl)).blob();
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], "clipboard.png", { type: "image/png" }));
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true }));
  }, PNG_DATA_URL);
}

test("入力欄に URL を入れて Enter でブックマークが増える", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;
    await openMainTerminal(window);

    const pane = await openBookmarks(window);
    await expect(window.getByText("No bookmarks", { exact: true })).toBeVisible();

    const input = pane.locator(".bookmark-compose .text-input");
    await input.fill("http://example.com/typed");
    await input.press("Enter");

    await expect(pane.locator(".bookmark-row")).toHaveCount(1);
    await expect(pane).toContainText("http://example.com/typed");
    // 成功したら入力は空に戻る
    await expect(input).toHaveValue("");

    // http/https でないものは登録されず、入力は直せるように残る
    await input.fill("ftp://example.com/file");
    await input.press("Enter");
    await expect(pane.locator(".bookmark-row")).toHaveCount(1);
    await expect(input).toHaveValue("ftp://example.com/file");
  } finally {
    await closeYuru(app);
  }
});

test("貼り付けた画像は × で破棄でき、打ちかけの URL は消えない", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;
    await openMainTerminal(window);

    const pane = await openBookmarks(window);
    const input = pane.locator(".bookmark-compose .text-input");
    await input.fill("http://example.com/typing");
    await pasteImage(pane);
    await expect(pane.locator(".bookmark-compose-attachment")).toBeVisible();

    // チップは透明な入力欄の下にあるが、× は押せる
    await pane.locator('[aria-label="Discard image"]').click();
    await expect(pane.locator(".bookmark-compose-attachment")).toHaveCount(0);
    await expect(input).toHaveValue("http://example.com/typing");
    await expect(pane.locator(".bookmark-row")).toHaveCount(0);
  } finally {
    await closeYuru(app);
  }
});

test("入力欄に画像を貼り付けて Enter で画像のブックマークが増える", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;
    await openMainTerminal(window);

    const pane = await openBookmarks(window);
    await pasteImage(pane);

    // 貼り付けただけでは登録されず、添付として入力欄に留まる
    const attachment = pane.locator(".bookmark-compose-attachment");
    const input = pane.locator(".bookmark-compose .text-input");
    await expect(attachment).toContainText("Pasted image");
    await expect(pane.locator(".bookmark-row")).toHaveCount(0);
    // 入力欄は外れずに残るので、貼り付けた直後もそのまま Enter を受けられる
    await expect(input).toBeFocused();

    await input.press("Enter");

    const row = pane.locator(".bookmark-row");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Pasted image");
    // 実体は ~/.yuru/bookmark-images に保存され、行のサムネイルはそれを直接指す
    const images = await readdir(path.join(context.yuruHome, "bookmark-images"));
    expect(images).toHaveLength(1);
    await expect(row.locator(".bookmark-thumbnail")).toHaveAttribute(
      "src",
      new RegExp(`^file://.*${images[0]}$`),
    );
    // 添付は登録後に消える
    await expect(attachment).toHaveCount(0);

    // 行のクリックは、外部ブラウザではなくプレビューで開く
    await row.locator(".bookmark-open").click();
    await expect(visibleWorktreeView(window).locator(".preview-filename")).toHaveText(images[0]);
    // git を通さない 1 枚絵として出る (Before / After には割れない)
    await expect(visibleWorktreeView(window).locator(".image-side-meta")).toHaveText(/^1 × 1 · /);

    // 削除するとブックマークも実体も残らない
    await row.locator('[aria-label="Remove bookmark"]').click();
    await expect(pane.locator(".bookmark-row")).toHaveCount(0);
    expect(await readdir(path.join(context.yuruHome, "bookmark-images"))).toHaveLength(0);
  } finally {
    await closeYuru(app);
  }
});
