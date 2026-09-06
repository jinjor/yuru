import assert from "node:assert/strict";
import test from "node:test";

import { GitHubStatusMonitor } from "../../../src/main/github/status-monitor.ts";
import { gitHubTargetKey } from "../../../src/main/github/github.ts";

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

const branch = (repoSlug, name) => ({ kind: "branch", repoSlug, branch: name });
const number = (repoSlug, n) => ({ kind: "number", repoSlug, number: n });

function item(status, title = "Title") {
  return { status, title, headRefOid: status.kind === "pr" ? "sha-head" : null };
}

function pullRequest(n, state = "open") {
  return item({ kind: "pr", number: n, state, isApproved: false, url: `https://x/${n}` });
}

// 束ねられた対象に対して、キーごとの値を引いて返すだけの fetch。
function fetchFrom(itemsByKey, log) {
  return async (targetsByRepoSlug) => {
    log?.push(
      [...targetsByRepoSlug].map(([repoSlug, targets]) => [
        repoSlug,
        targets.map((target) => gitHubTargetKey(target)),
      ]),
    );
    return new Map(
      [...targetsByRepoSlug.values()].flat().map((target) => {
        const key = gitHubTargetKey(target);
        return [key, itemsByKey.get(key) ?? null];
      }),
    );
  };
}

test("同じ対象を複数の worktree が見ていても 1 度しか取りに行かない", async () => {
  const target = number("jinjor/yuru", 71);
  const fetches = [];
  const monitor = new GitHubStatusMonitor({
    listTargets: async () => [target, { ...target }, branch("jinjor/yuru", "task-a")],
    fetchItems: fetchFrom(new Map(), fetches),
    tickCompleted: () => {},
  });

  monitor.start();
  await flush();
  monitor.stop();

  assert.deepEqual(fetches, [[["jinjor/yuru", ["jinjor/yuru#71", "jinjor/yuru@task-a"]]]]);
});

test("repository を跨いだ対象を 1 回の取得に束ねる", async () => {
  const fetches = [];
  const monitor = new GitHubStatusMonitor({
    listTargets: async () => [
      number("jinjor/yuru", 71),
      number("cli/cli", 900),
      // repository 名の大小は GitHub 上で区別されないので同じ束にまとまる。
      number("Jinjor/Yuru", 72),
    ],
    fetchItems: fetchFrom(new Map(), fetches),
    tickCompleted: () => {},
  });

  monitor.start();
  await flush();
  monitor.stop();

  assert.deepEqual(fetches, [
    [
      ["jinjor/yuru", ["jinjor/yuru#71", "jinjor/yuru#72"]],
      ["cli/cli", ["cli/cli#900"]],
    ],
  ]);
});

test("値が変わった対象のキーだけを知らせる", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const targets = [number("jinjor/yuru", 1), number("jinjor/yuru", 2)];
  const items = new Map([
    ["jinjor/yuru#1", pullRequest(1)],
    ["jinjor/yuru#2", pullRequest(2)],
  ]);
  const changes = [];
  const monitor = new GitHubStatusMonitor({
    listTargets: async () => targets,
    fetchItems: fetchFrom(items),
    tickCompleted: (changedKeys) => {
      changes.push([...changedKeys].sort());
    },
  });

  monitor.start();
  await flush();
  // 初回は全件が「変わった」。
  assert.deepEqual(changes, [["jinjor/yuru#1", "jinjor/yuru#2"]]);

  // 何も変わらない tick でも呼ぶが、変わったキーは空。
  t.mock.timers.tick(10_000);
  await flush();
  assert.deepEqual(changes[1], []);

  items.set("jinjor/yuru#2", pullRequest(2, "merged"));
  t.mock.timers.tick(10_000);
  await flush();
  monitor.stop();
  assert.deepEqual(changes[2], ["jinjor/yuru#2"]);
});

test("title だけが変わった場合も知らせる", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const target = number("jinjor/yuru", 1);
  const status = { kind: "issue", number: 1, state: "open", url: "https://x/1" };
  const items = new Map([["jinjor/yuru#1", item(status, "Before")]]);
  const changes = [];
  const monitor = new GitHubStatusMonitor({
    listTargets: async () => [target],
    fetchItems: fetchFrom(items),
    tickCompleted: (changedKeys) => changes.push([...changedKeys]),
  });

  monitor.start();
  await flush();
  items.set("jinjor/yuru#1", item(status, "After"));
  t.mock.timers.tick(10_000);
  await flush();
  monitor.stop();

  assert.deepEqual(
    changes,
    [["jinjor/yuru#1"], ["jinjor/yuru#1"]],
    "初回のあと、title の変化でもう 1 回",
  );
});

test("監視対象から外れたら覚えているのをやめる", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const target = number("jinjor/yuru", 1);
  let watched = [target];
  const monitor = new GitHubStatusMonitor({
    listTargets: async () => watched,
    fetchItems: fetchFrom(new Map([["jinjor/yuru#1", pullRequest(1)]])),
    tickCompleted: () => {},
  });

  monitor.start();
  await flush();
  assert.equal(monitor.get(target).status.number, 1);

  watched = [];
  t.mock.timers.tick(10_000);
  await flush();
  monitor.stop();

  assert.equal(monitor.get(target), undefined);
});

test("取得に失敗した対象は前回値のまま残す", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const target = number("jinjor/yuru", 1);
  let fetchResult = new Map([["jinjor/yuru#1", pullRequest(1)]]);
  const changes = [];
  const monitor = new GitHubStatusMonitor({
    listTargets: async () => [target],
    fetchItems: async () => fetchResult,
    tickCompleted: (changedKeys) => changes.push([...changedKeys]),
  });

  monitor.start();
  await flush();

  // クエリ全体の失敗。
  fetchResult = null;
  t.mock.timers.tick(10_000);
  await flush();
  assert.equal(monitor.get(target).status.number, 1);

  // 一部の repository だけ解決できず、その対象が結果に入らない場合。
  fetchResult = new Map();
  t.mock.timers.tick(10_000);
  await flush();
  monitor.stop();

  assert.equal(monitor.get(target).status.number, 1);
  assert.deepEqual(changes, [["jinjor/yuru#1"], [], []]);
});

test("tick 中に来た refresh() は捨てずに、その tick のあとで取り直す", async () => {
  const fetches = [];
  let resolveFirstFetch;
  const monitor = new GitHubStatusMonitor({
    listTargets: async () => [number("jinjor/yuru", 1)],
    fetchItems: (targetsByRepoSlug) => {
      fetches.push(targetsByRepoSlug);
      if (fetches.length === 1) {
        return new Promise((resolve) => {
          resolveFirstFetch = resolve;
        });
      }
      return Promise.resolve(new Map());
    },
    tickCompleted: () => {},
  });

  monitor.start();
  await flush();
  assert.equal(fetches.length, 1);

  monitor.refresh();
  await flush();
  assert.equal(fetches.length, 1, "実行中の tick は中断しない");

  resolveFirstFetch(new Map());
  await flush();
  await flush();
  monitor.stop();

  assert.equal(fetches.length, 2, "終わってから取り直す");
});

test("stop() されたら実行中の tick の残りを通知しない", async () => {
  let resolveFetch;
  const monitor = new GitHubStatusMonitor({
    listTargets: async () => [number("jinjor/yuru", 1)],
    fetchItems: () =>
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    tickCompleted: () => assert.fail("stop() 後に通知してはいけない"),
  });

  monitor.start();
  await flush();

  monitor.stop();
  resolveFetch(new Map([["jinjor/yuru#1", pullRequest(1)]]));
  await flush();
});
