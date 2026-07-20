import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { build } from "vite";
import { pruneRendererBuild } from "../../scripts/prune-renderer-build.mjs";

function createRendererBuild() {
  const rendererDir = fs.mkdtempSync(path.join(os.tmpdir(), "yuru-renderer-build-"));
  fs.mkdirSync(path.join(rendererDir, "assets"), { recursive: true });
  fs.mkdirSync(path.join(rendererDir, ".vite"), { recursive: true });
  fs.writeFileSync(path.join(rendererDir, "index.html"), "current html");
  fs.writeFileSync(path.join(rendererDir, "favicon.ico"), "public asset");
  fs.writeFileSync(path.join(rendererDir, "assets", "index-current.js"), "current entry");
  fs.writeFileSync(path.join(rendererDir, "assets", "index-current.css"), "current styles");
  fs.writeFileSync(path.join(rendererDir, "assets", "preview-current.js"), "current preview");
  fs.writeFileSync(path.join(rendererDir, "assets", "preview-stale.js"), "stale preview");
  fs.writeFileSync(
    path.join(rendererDir, ".vite", "manifest.json"),
    JSON.stringify({
      "index.html": {
        file: "assets/index-current.js",
        css: ["assets/index-current.css"],
        isEntry: true,
      },
      "src/MarkdownPreview.tsx": {
        file: "assets/preview-current.js",
        isDynamicEntry: true,
      },
    }),
  );
  return rendererDir;
}

test("app restart では manifest にない旧 renderer chunk だけを削除する", () => {
  const rendererDir = createRendererBuild();
  try {
    const removedFiles = pruneRendererBuild(rendererDir);

    assert.deepEqual(removedFiles, [path.join("assets", "preview-stale.js")]);
    assert.equal(fs.existsSync(path.join(rendererDir, "assets", "preview-stale.js")), false);
    assert.equal(fs.existsSync(path.join(rendererDir, "assets", "preview-current.js")), true);
    assert.equal(fs.existsSync(path.join(rendererDir, "favicon.ico")), true);
    assert.equal(fs.existsSync(path.join(rendererDir, ".vite", "manifest.json")), true);
  } finally {
    fs.rmSync(rendererDir, { recursive: true, force: true });
  }
});

test("build manifest がなければ build を先に実行するよう明示する", () => {
  const rendererDir = fs.mkdtempSync(path.join(os.tmpdir(), "yuru-renderer-build-"));
  fs.mkdirSync(path.join(rendererDir, "assets"), { recursive: true });
  try {
    assert.throws(
      () => pruneRendererBuild(rendererDir),
      /Vite manifest not found: .* Run `npm run build` first\./,
    );
  } finally {
    fs.rmSync(rendererDir, { recursive: true, force: true });
  }
});

test("通常 build は起動中の画面が参照する前世代の動的 chunk を残す", async () => {
  const rendererDir = fs.mkdtempSync(path.join(os.tmpdir(), "yuru-vite-generations-"));
  const configFile = path.resolve(import.meta.dirname, "../../vite.config.mts");
  const markdownChunks = () =>
    fs
      .readdirSync(path.join(rendererDir, "assets"))
      .filter((file) => file.startsWith("MarkdownPreview-"));

  try {
    await build({
      configFile,
      logLevel: "silent",
      build: { outDir: rendererDir, minify: true },
    });
    const [previousChunk] = markdownChunks();
    assert.ok(previousChunk);

    await build({
      configFile,
      logLevel: "silent",
      build: { outDir: rendererDir, minify: false },
    });
    const chunksAfterRebuild = markdownChunks();

    assert.equal(chunksAfterRebuild.length, 2);
    assert.ok(chunksAfterRebuild.includes(previousChunk));
  } finally {
    fs.rmSync(rendererDir, { recursive: true, force: true });
  }
});

test("package 用の掃除では build manifest も成果物から除く", () => {
  const rendererDir = createRendererBuild();
  try {
    pruneRendererBuild(rendererDir, { removeManifest: true });

    assert.equal(fs.existsSync(path.join(rendererDir, ".vite")), false);
    assert.equal(fs.existsSync(path.join(rendererDir, "assets", "preview-current.js")), true);
  } finally {
    fs.rmSync(rendererDir, { recursive: true, force: true });
  }
});
