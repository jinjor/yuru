import type { PlanUsageWindow, ProviderPlanUsage, SessionProvider } from "../../shared/session.js";

// provider がその枠を使い切ったと見なす使用率。
const EXHAUSTED_PERCENT = 100;

// リセット時刻を過ぎても provider がまだ使い切りを報告している時に、次に確かめるまでの間隔。
// 過ぎた時刻へタイマーを張り直し続けて取得が止まらなくなるのを防ぐ。
const RECHECK_INTERVAL_MS = 60_000;

function planUsageWindows(usage: ProviderPlanUsage): PlanUsageWindow[] {
  if (usage.state !== "ok") {
    return [];
  }
  return [usage.fiveHour, usage.weekly].flatMap((window) => (window === null ? [] : [window]));
}

// 使い切っている枠が最後にリセットされる時刻。帯の表示にも同じ値を使う。1 つでも使い切っていればリクエストは
// 通らないので、解消するのは全部リセットされた後になる。使い切っていなければ
// undefined、使い切っているがリセット時刻を返さない枠がある場合は null を返す。
export function exhaustedUntil(usage: ProviderPlanUsage): number | null | undefined {
  const exhausted = planUsageWindows(usage).filter(
    (window) => window.usedPercent >= EXHAUSTED_PERCENT,
  );
  if (exhausted.length === 0) {
    return undefined;
  }
  const resetsAt = exhausted.map((window) => window.resetsAt);
  if (resetsAt.includes(null)) {
    return null;
  }
  return Math.max(...resetsAt.map((at) => at ?? 0));
}

export interface RateLimitRecoveryDeps {
  // 利用状況を取り直す。結果は update() へ入ってくる。
  refreshPlanUsage(): void;
  // その provider に「解除されたら続きを実行する」と指定された session があるか。
  hasWaitingSessions(provider: SessionProvider): boolean;
  resumeSessions(provider: SessionProvider): void;
}

// プラン利用状況の更新列から「枠を使い切った → 解消した」の変わり目を見つける。
// 端末の出力からエラー文言を探す方法は取らない。provider が公式に返す使用率で
// 同じことが分かり、Yuru 自身の再起動をまたいでも取り直せるため。
//
// 定期取得はウィンドウがフォーカスされている間しか動かないので、それだけに頼ると
// 離席中に解消しても気付けない。使い切りを見つけた時点でリセット時刻が絶対時刻で
// 分かっているので、その時刻に取り直しを予約してフォーカスと切り離す。
export class RateLimitRecovery {
  private readonly deps: RateLimitRecoveryDeps;
  // 使い切っている provider と、その解消時刻 (分からない場合は null)。
  private readonly exhausted = new Map<SessionProvider, number | null>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(deps: RateLimitRecoveryDeps) {
    this.deps = deps;
  }

  update(usages: readonly ProviderPlanUsage[]): void {
    for (const usage of usages) {
      const until = exhaustedUntil(usage);
      if (until !== undefined) {
        this.exhausted.set(usage.provider, until);
        continue;
      }
      // 取得に失敗した回は「解消した」根拠にならないので、使い切った記録を残して
      // 次の取得を待つ。
      if (usage.state === "failed") {
        continue;
      }
      if (this.exhausted.delete(usage.provider)) {
        this.deps.resumeSessions(usage.provider);
      }
    }
    this.scheduleRecheck();
  }

  stop(): void {
    this.clearTimer();
  }

  // 続きの実行を待っている session が無ければ、解消を急いで知る理由が無いので
  // 取り直しを予約しない。待っている provider の中で一番早く解消する時刻に 1 本だけ
  // 張る。取り直した結果が update() に入って、まだ使い切っていれば張り直される。
  private scheduleRecheck(): void {
    this.clearTimer();
    const resetsAt = [...this.exhausted]
      .filter(([provider]) => this.deps.hasWaitingSessions(provider))
      .flatMap(([, at]) => (at === null ? [] : [at]));
    if (resetsAt.length === 0) {
      return;
    }
    const remaining = Math.min(...resetsAt) - Date.now();
    this.timer = setTimeout(
      () => {
        this.timer = null;
        this.deps.refreshPlanUsage();
      },
      remaining > 0 ? remaining : RECHECK_INTERVAL_MS,
    );
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
