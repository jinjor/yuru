import assert from "node:assert/strict";
import test from "node:test";

import { parseNameStatusZ, parseNumstatZ, parseRawDiffZ } from "../../../src/main/git/diff.ts";

test("parseNumstatZ は path ごとの追加・削除行数を返す", () => {
  const output = "12\t3\tsrc/app.ts\0" + "0\t0\tsrc/mode-only.sh\0";

  assert.deepEqual(
    parseNumstatZ(output),
    new Map([
      ["src/app.ts", { added: 12, deleted: 3 }],
      ["src/mode-only.sh", { added: 0, deleted: 0 }],
    ]),
  );
});

test("parseNumstatZ は空出力で空 Map を返す", () => {
  assert.deepEqual(parseNumstatZ(""), new Map());
});

test("parseNumstatZ は rename を移動先 path で返す", () => {
  const output = "5\t1\t\0old/name.ts\0new/name.ts\0" + "2\t0\tsrc/other.ts\0";

  assert.deepEqual(
    parseNumstatZ(output),
    new Map([
      ["new/name.ts", { added: 5, deleted: 1 }],
      ["src/other.ts", { added: 2, deleted: 0 }],
    ]),
  );
});

test("parseNumstatZ は binary file を行数なしとして除く", () => {
  const output = "-\t-\tassets/icon.png\0" + "1\t0\tsrc/app.ts\0";

  assert.deepEqual(parseNumstatZ(output), new Map([["src/app.ts", { added: 1, deleted: 0 }]]));
});

test("parseNameStatusZ は rename を移動元つきで返す", () => {
  const output = "M\0src/app.ts\0" + "R100\0old/name.ts\0new/name.ts\0" + "A\0src/new.ts\0";

  assert.deepEqual(parseNameStatusZ(output), [
    { status: "M", path: "src/app.ts" },
    { status: "R100", path: "new/name.ts", srcPath: "old/name.ts" },
    { status: "A", path: "src/new.ts" },
  ]);
});

test("parseRawDiffZ は両側の blob OID と rename 元を返す", () => {
  const oldOid = "1".repeat(40);
  const newOid = "2".repeat(40);
  const output =
    `:100644 100644 ${oldOid} ${newOid} M\0src/app.ts\0` +
    `:100644 100644 ${oldOid} ${newOid} R100\0old/name.ts\0new/name.ts\0`;

  assert.deepEqual(parseRawDiffZ(output), [
    { status: "M", path: "src/app.ts", srcOid: oldOid, dstOid: newOid },
    {
      status: "R100",
      path: "new/name.ts",
      srcPath: "old/name.ts",
      srcOid: oldOid,
      dstOid: newOid,
    },
  ]);
});
