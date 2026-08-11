import assert from "node:assert/strict";
import test from "node:test";

import {
  clearErrorNotices,
  dismissErrorNotice,
  listErrorNotices,
  recordAppError,
  recordAppWarning,
  setErrorNoticesListener,
} from "../../../src/main/errors/center.ts";

function silenceConsole(t) {
  t.mock.method(console, "error", () => {});
  t.mock.method(console, "warn", () => {});
}

test("recordAppError は severity error / count 1 の notice を先頭に積む", (t) => {
  silenceConsole(t);
  clearErrorNotices();

  recordAppError({ code: "unknown", message: "first" });
  recordAppError({ code: "unknown", message: "second", detail: "d" });

  const notices = listErrorNotices();
  assert.equal(notices.length, 2);
  assert.equal(notices[0].message, "second");
  assert.equal(notices[0].detail, "d");
  assert.equal(notices[0].severity, "error");
  assert.equal(notices[0].count, 1);
});

test("連続する同一内容は 1 行にまとめて count と timestamp を更新する", (t) => {
  silenceConsole(t);
  clearErrorNotices();

  const first = recordAppError({ code: "git_failed", message: "same", detail: "x" });
  const merged = recordAppError({ code: "git_failed", message: "same", detail: "x" });

  const notices = listErrorNotices();
  assert.equal(notices.length, 1);
  assert.equal(notices[0].count, 2);
  assert.equal(merged.id, first.id);
  assert.ok(merged.timestamp >= first.timestamp);
});

test("間に別のエラーが挟まったらまとめない", (t) => {
  silenceConsole(t);
  clearErrorNotices();

  recordAppError({ code: "unknown", message: "a" });
  recordAppError({ code: "unknown", message: "b" });
  recordAppError({ code: "unknown", message: "a" });

  const notices = listErrorNotices();
  assert.equal(notices.length, 3);
  assert.equal(notices[0].count, 1);
});

test("severity や detail が違えばまとめない", (t) => {
  silenceConsole(t);
  clearErrorNotices();

  recordAppError({ code: "unknown", message: "same" });
  recordAppWarning({ code: "unknown", message: "same" });
  recordAppWarning({ code: "unknown", message: "same", detail: "d" });

  const notices = listErrorNotices();
  assert.equal(notices.length, 3);
  assert.equal(notices[0].severity, "warning");
  assert.equal(notices[0].detail, "d");
});

test("保持数は 25 行まで", (t) => {
  silenceConsole(t);
  clearErrorNotices();

  for (let i = 0; i < 30; i++) {
    recordAppError({ code: "unknown", message: `message ${i}` });
  }

  const notices = listErrorNotices();
  assert.equal(notices.length, 25);
  assert.equal(notices[0].message, "message 29");
});

test("dismiss は id の行だけ消し、clear は全部消す", (t) => {
  silenceConsole(t);
  clearErrorNotices();

  const target = recordAppError({ code: "unknown", message: "a" });
  recordAppError({ code: "unknown", message: "b" });

  assert.equal(dismissErrorNotice(target.id), true);
  assert.equal(dismissErrorNotice(target.id), false);
  assert.deepEqual(
    listErrorNotices().map((notice) => notice.message),
    ["b"],
  );

  assert.equal(clearErrorNotices(), true);
  assert.equal(listErrorNotices().length, 0);
  assert.equal(clearErrorNotices(), false);
});

test("記録・削除・全消去のたびに listener へ現在の一覧が届く", (t) => {
  silenceConsole(t);
  clearErrorNotices();

  const received = [];
  setErrorNoticesListener((notices) => {
    received.push(notices);
  });
  t.after(() => {
    setErrorNoticesListener(() => {});
  });

  const notice = recordAppError({ code: "unknown", message: "a" });
  recordAppError({ code: "unknown", message: "a" });
  dismissErrorNotice(notice.id);

  assert.equal(received.length, 3);
  assert.equal(received[0].length, 1);
  assert.equal(received[1][0].count, 2);
  assert.equal(received[2].length, 0);
});
