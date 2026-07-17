import { register } from "node:module";

// git hook 経由でテストが走ると GIT_DIR / GIT_WORK_TREE が設定されている。
// テストや被テストコードが spawn する git がこれを見ると、一時リポジトリ
// ではなく本物のリポジトリを操作してしまうため、入口で環境から外す
delete process.env.GIT_DIR;
delete process.env.GIT_WORK_TREE;

register("./test-ts-resolver.mjs", import.meta.url);
