import { expect, test, type ElectronApplication } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
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
} from "./helpers";

test("変更した画像は前後を同じ倍率で並べてプレビューする", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    await writeFile(path.join(repoDir, "logo.png"), makePng(40, 20, [220, 80, 80]));
    git(["add", "logo.png"], repoDir);
    git(["commit", "-m", "add logo"], repoDir);
    // 色も寸法も変える (2 枚が同じ倍率で並ぶことと、寸法差の表示を同時に確認する)
    await writeFile(path.join(repoDir, "logo.png"), makePng(60, 20, [80, 120, 220]));
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;
    await openMainTerminal(window);

    await window.locator(".change-item", { hasText: "logo.png" }).click();
    await expectPreviewPath(window, "logo.png");

    // 両側が寸法とファイルサイズ付きで並ぶ
    const sessionView = visibleWorktreeView(window);
    await expect(sessionView.locator(".image-side", { hasText: "Before" })).toContainText(
      "40 × 20",
    );
    await expect(sessionView.locator(".image-side", { hasText: "After" })).toContainText("60 × 20");

    // 寸法が違っても両側を同じ倍率で置く (描画幅の比が元の幅の比と一致する)
    const layers = sessionView.locator(".image-layer");
    await expect(layers).toHaveCount(2);
    const renderedWidths = await layers.evaluateAll((images) =>
      images.map((image) => image.getBoundingClientRect().width),
    );
    expect(renderedWidths[0] / renderedWidths[1]).toBeCloseTo(40 / 60, 2);

    // バイナリなのでヘッダに行数は出さない
    await expect(sessionView.locator(".line-stat")).toBeHidden();
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("開いている間に画像が書き換わったら表示も追従する", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    await writeFile(path.join(repoDir, "live.png"), makePng(40, 20, [220, 80, 80]));
    git(["add", "live.png"], repoDir);
    git(["commit", "-m", "add live"], repoDir);
    await writeFile(path.join(repoDir, "live.png"), makePng(60, 20, [80, 120, 220]));
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;
    await openMainTerminal(window);

    await window.locator(".change-item", { hasText: "live.png" }).click();
    const sessionView = visibleWorktreeView(window);
    await expect(sessionView.locator(".image-side", { hasText: "After" })).toContainText("60 × 20");

    // 表示中に別の内容へ書き換える。Reviewed は押した時点の内容を記録するので、
    // 画面が古い画像のまま取り残されると、見ていない内容を承認できてしまう。
    await writeFile(path.join(repoDir, "live.png"), makePng(80, 20, [120, 200, 140]));
    await expect(sessionView.locator(".image-side", { hasText: "After" })).toContainText(
      "80 × 20",
      {
        timeout: 10_000,
      },
    );
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

test("追加された画像と worktree の画像は 1 枚で表示する", async () => {
  const context = await createE2eContext();
  let app: ElectronApplication | null = null;
  try {
    const repoDir = await createCommittedRepo(context);
    await writeFile(path.join(repoDir, "shot.png"), makePng(30, 30, [120, 200, 140]));
    await registerRepo(context, repoDir);
    const launched = await launchWindow(context);
    app = launched.app;
    const window = launched.window;
    await openMainTerminal(window);
    const sessionView = visibleWorktreeView(window);

    // 未追跡ファイル = 追加なので、比較する元がない
    await window.locator(".change-item", { hasText: "shot.png" }).click();
    await expectPreviewPath(window, "shot.png");
    await expect(sessionView.locator(".image-side-label")).toHaveText("Added");
    await expect(sessionView.locator(".image-side-meta")).toContainText("30 × 30");

    // Files から開いた変更なしの画像も 1 枚のまま
    git(["add", "shot.png"], repoDir);
    git(["commit", "-m", "add shot"], repoDir);
    await sessionView.locator(".panel-tab", { hasText: "Files" }).click();
    await sessionView.locator(".file-tree-row", { hasText: "shot.png" }).click();
    await expect(sessionView.locator(".image-side-label")).toBeHidden();
    await expect(sessionView.locator(".image-side-meta")).toContainText("30 × 30");
  } finally {
    await closeYuru(app);
    await context.cleanup();
  }
});

// 単色の truecolor PNG を組み立てる (テスト用の画像を外部ファイルとして持たないため)。
function makePng(width: number, height: number, [r, g, b]: [number, number, number]): Buffer {
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 3);
    // 各行の先頭 1 byte はフィルタ種別 (0 = None)
    raw[rowStart] = 0;
    for (let x = 0; x < width; x++) {
      const pixel = rowStart + 1 + x * 3;
      raw[pixel] = r;
      raw[pixel + 1] = g;
      raw[pixel + 2] = b;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor
  // 10-12: compression / filter / interlace はいずれも 0 (規格上の唯一の値)

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.byteLength, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}
