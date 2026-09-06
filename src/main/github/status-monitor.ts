import { recordAppWarning } from "../errors/center.js";
import { toAppError } from "../errors/app-error.js";
import { gitHubTargetKey, type FetchedGitHubItem, type GitHubTarget } from "./github.js";

// tick は 10 秒ごと。対象が何件あっても 1 tick = 1 クエリなので、対象の数で
// 間隔を変える必要はない。
const TICK_INTERVAL_MS = 10_000;

export interface GitHubStatusMonitorOptions {
  // tick ごとに、いま監視すべき対象を集める。重複していてもよい。
  listTargets(): Promise<readonly GitHubTarget[]>;
  fetchItems(
    targetsByRepoSlug: ReadonlyMap<string, readonly GitHubTarget[]>,
  ): Promise<ReadonlyMap<string, FetchedGitHubItem | null> | null>;
  // tick の終わりに毎回呼ぶ。changedKeys は今回値が変わった対象のキーで、
  // 何が変わったかの解釈は呼び出し側が行う。GitHub 側に変化が無くてもローカルの
  // 事情で表示が変わることがあるため、空でも呼ぶ。
  tickCompleted(changedKeys: ReadonlySet<string>): void;
}

// 変化検知のための比較用。呼び出し側に渡る値がすべて入っていればよい。
function itemSignature(item: FetchedGitHubItem | null): string {
  if (!item) {
    return "";
  }
  const { status } = item;
  return JSON.stringify([
    status.kind,
    status.number,
    status.state,
    status.kind === "pr" ? status.isApproved : null,
    status.url,
    item.title,
    item.headRefOid,
  ]);
}

// 同じ対象は 1 度しか取らない (何か所から参照されていてもエイリアスは 1 本)。
// repository 名の大小は GitHub 上で区別されないので、小文字に揃えてから束ねる。
function groupByRepoSlug(targets: readonly GitHubTarget[]): Map<string, GitHubTarget[]> {
  const seenKeys = new Set<string>();
  const grouped = new Map<string, GitHubTarget[]>();
  for (const target of targets) {
    const key = gitHubTargetKey(target);
    if (seenKeys.has(key)) {
      continue;
    }
    seenKeys.add(key);
    const repoSlug = target.repoSlug.toLowerCase();
    const group = grouped.get(repoSlug) ?? [];
    group.push(target);
    grouped.set(repoSlug, group);
  }
  return grouped;
}

// GitHub の Issue / PR のステータスを、監視対象のぶんだけ新鮮に保つ。
// ウィンドウがフォーカスされている間だけ動く。対象が Yuru の何に対応するかは知らず、
// 「どの対象を見るか」だけを扱う。
export class GitHubStatusMonitor {
  private readonly options: GitHubStatusMonitorOptions;
  private readonly cache = new Map<string, FetchedGitHubItem | null>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  private refreshRequested = false;

  constructor(options: GitHubStatusMonitorOptions) {
    this.options = options;
  }

  start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      void this.tick();
    }, TICK_INTERVAL_MS);
    void this.tick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  // 監視対象が増えたときに、次の tick を待たずに取りに行く。
  refresh(): void {
    if (!this.timer) {
      return;
    }
    if (this.ticking) {
      // 実行中の tick は増えた対象を知らないので、終わってから続けて取り直す。
      this.refreshRequested = true;
      return;
    }
    void this.tick();
  }

  // 最後に取れた値。undefined は「まだ取っていない」、null は「その対象が無い」。
  get(target: GitHubTarget): FetchedGitHubItem | null | undefined {
    return this.cache.get(gitHubTargetKey(target));
  }

  private async tick(): Promise<void> {
    if (this.ticking) {
      return;
    }
    this.ticking = true;
    // stop() は timer を落とす。実行中の tick は await のたびに自分の timer が
    // 現役かを確かめ、停止済みなら以降の取得も通知もやめる。
    const timer = this.timer;
    try {
      const targets = await this.options.listTargets();
      if (this.timer !== timer) {
        return;
      }
      this.forgetUnwatched(targets);

      const fetched = await this.options.fetchItems(groupByRepoSlug(targets));
      if (this.timer !== timer) {
        return;
      }
      this.options.tickCompleted(fetched ? this.store(fetched) : new Set());
    } catch (error) {
      // 対象の収集 (git 呼び出しなど) の失敗。次の tick でやり直す。
      recordAppWarning(toAppError(error));
    } finally {
      this.ticking = false;
      const rerun = this.refreshRequested && this.timer === timer;
      this.refreshRequested = false;
      if (rerun) {
        void this.tick();
      }
    }
  }

  private forgetUnwatched(targets: readonly GitHubTarget[]): void {
    const watchedKeys = new Set(targets.map(gitHubTargetKey));
    for (const key of this.cache.keys()) {
      if (!watchedKeys.has(key)) {
        this.cache.delete(key);
      }
    }
  }

  // 取れた対象だけを覚え直す。結果に無い対象 (解決できなかった repository の分) は
  // 前回値のまま残す。
  private store(fetched: ReadonlyMap<string, FetchedGitHubItem | null>): Set<string> {
    const changedKeys = new Set<string>();
    for (const [key, item] of fetched) {
      const cached = this.cache.get(key);
      if (cached === undefined || itemSignature(cached) !== itemSignature(item)) {
        changedKeys.add(key);
      }
      this.cache.set(key, item);
    }
    return changedKeys;
  }
}
