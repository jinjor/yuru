import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PdfPreviewGrants } from "../../../src/main/preview/pdf-preview.ts";
import { isPdfPath, MAX_PDF_PREVIEW_BYTES } from "../../../src/shared/pdf-preview.ts";

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "yuru-pdf-preview-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "selected.pdf");
  await fs.writeFile(file, "%PDF-1.4\nselected");
  return { dir, file };
}

test("PDF の拡張子は大文字も含め、ファイル名だけから判定する", () => {
  for (const file of ["document.pdf", "dir/日本語.PDF", "/tmp/a.pdf"]) {
    assert.equal(isPdfPath(file), true);
  }
  for (const file of [".pdf", "dir.pdf/file", "document.pdf.html", "README"]) {
    assert.equal(isPdfPath(file), false);
  }
});

test("選択した版の PDF のみを固定 MIME で返し、隣接ファイル・パス逸脱・別 method を拒否する", async (t) => {
  const { file } = await fixture(t);
  const grants = new PdfPreviewGrants();
  const grant = await grants.create(file);
  assert.ok(grant);
  assert.equal(grant.url.includes(file), false);
  await fs.writeFile(file, "new content");
  const response = grants.respond(grant.url, "GET");
  assert.equal(await response.text(), "%PDF-1.4\nselected");
  assert.equal(response.headers.get("Content-Type"), "application/pdf");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  for (const relative of [
    "./secret.txt",
    "./entry.html",
    "./%2e%2e%2fsecret.txt",
    "./%2fetc%2fpasswd",
  ]) {
    assert.equal(grants.respond(new URL(relative, grant.url).href, "GET").status, 404);
  }
  assert.equal(grants.respond(grant.url, "POST").status, 404);
  assert.equal(grants.respond(grant.url.replace("yuru-pdf:", "https:"), "GET").status, 404);
});

test("表示終了・再読み込みで許可を解放すると、同じ URL からは読めない", async (t) => {
  const { file } = await fixture(t);
  const grants = new PdfPreviewGrants();
  const first = await grants.create(file);
  const second = await grants.create(file);
  assert.equal(grants.isActive(first.url), true);
  grants.release(first.id);
  assert.equal(grants.respond(first.url, "GET").status, 404);
  assert.equal(grants.respond(second.url, "GET").status, 200);
  grants.clear();
  assert.equal(grants.respond(second.url, "GET").status, 404);
  const pending = grants.create(file);
  grants.clear();
  assert.equal(await pending, null);
});

test("サイズ上限は開いた実ファイルに適用する", async (t) => {
  const { file } = await fixture(t);
  const grants = new PdfPreviewGrants();
  const handle = await fs.open(file, "r+");
  await handle.truncate(MAX_PDF_PREVIEW_BYTES + 1);
  await handle.close();
  assert.equal(await grants.create(file), null);
});

test("読込み前に symlink に差し替えられたファイルは辿らない", async (t) => {
  const { dir, file } = await fixture(t);
  const secret = path.join(dir, "secret.txt");
  await fs.writeFile(secret, "not selected");
  await fs.rm(file);
  await fs.symlink(secret, file);
  await assert.rejects(new PdfPreviewGrants().create(file), { code: "ELOOP" });
});
