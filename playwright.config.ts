import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/e2e",
  testMatch: /.*\.test\.ts/,
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  // 1 回目で落ちても、やり直して通れば失敗にしない。実装中に flaky で赤くなると、
  // 変更と無関係かどうかの切り分けに時間を取られるため。retry で通ったテストは
  // レポートに flaky として残るので、その件数を見て別途 flaky を潰す。
  retries: 1,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
});
