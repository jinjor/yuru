import type { ProviderPlanUsage, SessionProvider } from "../../shared/session.js";

// その provider の枠を使い切っているか。provider 自身が返す使用率が 100% に達した枠が
// 1 つでもあれば、リセットまではその provider へのリクエストは通らない。
function isExhausted(usage: ProviderPlanUsage): boolean {
  if (usage.state !== "ok") {
    return false;
  }
  return [usage.fiveHour, usage.weekly].some(
    (window) => window !== null && window.usedPercent >= 100,
  );
}

// プラン利用状況の更新列から「枠を使い切った → 解消した」の変わり目を見つける。
// 端末の出力からエラー文言を探す方法は取らない。provider が公式に返す使用率で
// 同じことが分かり、Yuru 自身の再起動をまたいでも取り直せるため。
export class RateLimitRecovery {
  private readonly exhausted = new Set<SessionProvider>();
  private readonly onRecovered: (provider: SessionProvider) => void;

  constructor(onRecovered: (provider: SessionProvider) => void) {
    this.onRecovered = onRecovered;
  }

  update(usages: readonly ProviderPlanUsage[]): void {
    for (const usage of usages) {
      if (isExhausted(usage)) {
        this.exhausted.add(usage.provider);
        continue;
      }
      // 取得に失敗した回は「解消した」根拠にならないので、使い切った記録を残して
      // 次の取得を待つ。
      if (usage.state === "failed") {
        continue;
      }
      if (this.exhausted.delete(usage.provider)) {
        this.onRecovered(usage.provider);
      }
    }
  }
}
