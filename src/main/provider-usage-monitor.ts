import type { ProviderPlanUsage, SessionProvider } from "../shared/session.js";
import type { PlanUsage } from "./agent.js";
import { recordAppWarning } from "./error-center.js";
import { toAppError } from "./errors.js";
import type { ResolvedProviderCommand } from "./provider-command.js";

// ウィンドウがフォーカスされている間だけ動くプラン利用状況のポーリング。
// 1 tick で「ログインシェルに 3 provider のパスを解決させる → 見つかった provider を
// 並列に取得する」を行う。5 時間枠は実作業で数分のうちに数 % 動くので 60 秒間隔。
const TICK_INTERVAL_MS = 60_000;

export interface ProviderUsageMonitorDeps {
  listProviders(): { provider: SessionProvider; command: string }[];
  resolveCommandPaths(commands: readonly string[]): Promise<Map<string, ResolvedProviderCommand>>;
  loadPlanUsage(provider: SessionProvider, command: ResolvedProviderCommand): Promise<PlanUsage>;
  planUsageChanged(usages: ProviderPlanUsage[]): void;
}

export class ProviderUsageMonitor {
  private readonly deps: ProviderUsageMonitorDeps;
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;

  constructor(deps: ProviderUsageMonitorDeps) {
    this.deps = deps;
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

  // 一覧が空だと新規セッションを開始できないので、フォーカスが無くても起動時に
  // 1 回だけ取る。定期取得は始めない。
  async refreshOnce(): Promise<void> {
    await this.tick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    if (this.ticking) {
      return;
    }
    this.ticking = true;
    try {
      const providers = this.deps.listProviders();
      let commands: Map<string, ResolvedProviderCommand>;
      try {
        commands = await this.deps.resolveCommandPaths(
          providers.map((provider) => provider.command),
        );
      } catch (error) {
        // ログインシェルが起動しないのは想定外。ここで空の一覧を push すると
        // 「どの provider も入っていない」ことになり、セッションを開始できなくなる。
        // 前回の一覧を残したいので、この tick は何も push せずに終える。
        recordAppWarning(toAppError(error, { command: "login shell" }));
        return;
      }
      // 見つからなかった provider は結果に入れない。「一覧に居ない = 入っていない」
      // として、利用状況の行にも新規セッションの選択肢にも出さない。
      const installed = providers.flatMap((provider) => {
        const command = commands.get(provider.command);
        return command === undefined ? [] : [{ ...provider, resolved: command }];
      });
      this.deps.planUsageChanged(await Promise.all(installed.map((entry) => this.loadOne(entry))));
    } finally {
      this.ticking = false;
    }
  }

  private async loadOne(entry: {
    provider: SessionProvider;
    command: string;
    resolved: ResolvedProviderCommand;
  }): Promise<ProviderPlanUsage> {
    const provider = entry.provider;
    try {
      const usage = await this.deps.loadPlanUsage(provider, entry.resolved);
      if (usage.state !== "ok") {
        // 未ログインとプラン外は「そういう状態である」だけなのでエラーにしない。
        return { provider, state: usage.state };
      }
      return {
        provider,
        state: "ok",
        fiveHour: usage.fiveHour,
        weekly: usage.weekly,
        fetchedAt: Date.now(),
      };
    } catch (error) {
      recordAppWarning(toAppError(error, { command: entry.command }));
      return { provider, state: "failed" };
    }
  }
}
