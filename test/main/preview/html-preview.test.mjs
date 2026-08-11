import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  HTML_PREVIEW_CSP,
  HTML_PREVIEW_SCHEME,
  HtmlPreviewGrants,
} from "../../../src/main/preview/html-preview.ts";

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "yuru-html-preview-"));
}

test("entry HTML は渡された内容を返し、相対 CSS / JavaScript は許可ルートから読む", async (t) => {
  const dir = makeTempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, "mock"));
  fs.writeFileSync(path.join(dir, "mock", "index.html"), "working tree");
  fs.writeFileSync(path.join(dir, "mock", "style.css"), "body { color: red; }");
  fs.writeFileSync(path.join(dir, "mock", "app.js"), "document.body.dataset.loaded = 'yes';");

  const grants = new HtmlPreviewGrants();
  const grant = await grants.create(dir, "mock/index.html", "selected diff content");

  assert.match(grant.url, new RegExp(`^${HTML_PREVIEW_SCHEME}://`));

  const html = await grants.respond(grant.url);
  assert.equal(html.status, 200);
  assert.equal(html.body.toString(), "selected diff content");
  assert.equal(html.headers["Content-Type"], "text/html; charset=utf-8");
  assert.equal(html.headers["Content-Security-Policy"], HTML_PREVIEW_CSP);

  const css = await grants.respond(new URL("./style.css", grant.url).toString());
  assert.equal(css.status, 200);
  assert.equal(css.body.toString(), "body { color: red; }");
  assert.equal(css.headers["Content-Type"], "text/css; charset=utf-8");

  const script = await grants.respond(new URL("./app.js", grant.url).toString());
  assert.equal(script.status, 200);
  assert.equal(script.body.toString(), "document.body.dataset.loaded = 'yes';");
  assert.equal(script.headers["Content-Type"], "text/javascript; charset=utf-8");
});

test("許可ルートの外へ出る path と symlink は拒否する", async (t) => {
  const dir = makeTempDir();
  const outside = makeTempDir();
  t.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(dir, "index.html"), "<h1>preview</h1>");
  fs.writeFileSync(path.join(outside, "secret.js"), "secret");
  fs.symlinkSync(path.join(outside, "secret.js"), path.join(dir, "linked.js"));

  const grants = new HtmlPreviewGrants();
  const grant = await grants.create(dir, "index.html", "<h1>preview</h1>");
  const token = new URL(grant.url).hostname;

  const traversal = await grants.respond(
    `${HTML_PREVIEW_SCHEME}://${token}/..%2F${path.basename(outside)}%2Fsecret.js`,
  );
  assert.equal(traversal.status, 403);

  const symlink = await grants.respond(new URL("./linked.js", grant.url).toString());
  assert.equal(symlink.status, 403);
});

test("grant を release すると同じ URL は読めない", async (t) => {
  const dir = makeTempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, "index.html"), "<h1>preview</h1>");

  const grants = new HtmlPreviewGrants();
  const grant = await grants.create(dir, "index.html", "<h1>preview</h1>");
  grants.release(grant.id);

  const response = await grants.respond(grant.url);
  assert.equal(response.status, 404);
});
