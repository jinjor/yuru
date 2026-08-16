import type { PlanUsageWindow, ProviderPlanUsage } from "../../shared/session.js";

// provider がその枠を使い切ったと見なす使用率。
const EXHAUSTED_PERCENT = 100;

function planUsageWindows(usage: ProviderPlanUsage): PlanUsageWindow[] {
  if (usage.state !== "ok") {
    return [];
  }
  return [usage.fiveHour, usage.weekly].flatMap((window) => (window === null ? [] : [window]));
}

// 使い切っている枠が最後にリセットされる時刻。1 つでも使い切っていればリクエストは
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

// 利用率はリセット前にも下がることがあるため、解除は provider が返した時刻だけで判定する。
// 時刻を返さない provider については、利用率から解除を推測しない。
export function isRateLimitResetDue(resetsAt: number | null, now: number): boolean {
  return resetsAt !== null && now >= resetsAt;
}

// 続きの実行を待っている session の解除時刻から、次に解除処理をするまでの待ち時間。
// 待っている session が無い、またはリセット時刻が分からない場合は予約しない (null)。
export function nextResetDelayMs(resetsAt: readonly (number | null)[], now: number): number | null {
  const known = resetsAt.flatMap((at) => (at === null ? [] : [at]));
  if (known.length === 0) {
    return null;
  }
  const remaining = Math.min(...known) - now;
  return Math.max(0, remaining);
}
