import { useEffect, useState } from "react";
import type { PlanUsageWindow, ProviderPlanUsage } from "../../shared/session";
import { providerLabel } from "./providerLabel";
import { formatRemaining } from "./planUsageRemaining";

// リセットまでの残り時間は分単位で出すので、これくらいの間隔で見直せば足りる。
const CLOCK_INTERVAL_MS = 30_000;

interface ProviderPlanUsageRowsProps {
  usages: ProviderPlanUsage[];
}

// sidebar のフッタに出す、provider ごとのプラン利用状況。worktree にも repo にも
// 紐づかないアプリ全体の情報なので、Errors 行と並べて置く。
// インストールされていない provider は usages に現れないため、行ごと出ない。
export function ProviderPlanUsageRows({ usages }: ProviderPlanUsageRowsProps) {
  // 残り時間の再計算だけのために App 全体を再描画したくないので、時計はここで持つ。
  const now = useNow();
  if (usages.length === 0) {
    return null;
  }
  return (
    <div className="plan-usage">
      <div className="plan-usage-heading">
        <span className="plan-usage-provider" />
        <span className="plan-usage-window-label">5h</span>
        <span className="plan-usage-window-label">7d</span>
      </div>
      {usages.map((usage) => (
        <div className="plan-usage-row" key={usage.provider} title={rowTitle(usage)}>
          <span className="plan-usage-provider">
            <span
              className={`session-provider-dot provider-${usage.provider}`}
              aria-hidden="true"
            />
            {providerLabel(usage.provider)}
          </span>
          {usage.state === "ok" ? (
            <>
              <PlanUsageCell window={usage.fiveHour} now={now} />
              <PlanUsageCell window={usage.weekly} now={now} />
            </>
          ) : (
            // 取れなかったときは前回の数字を残さず、理由に置き換える。
            // 古い数字が残ると、取れていないことに気づけない。
            <span className="plan-usage-unavailable">{unavailableLabel(usage.state)}</span>
          )}
        </div>
      ))}
    </div>
  );
}

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, CLOCK_INTERVAL_MS);
    return () => {
      clearInterval(timer);
    };
  }, []);
  return now;
}

function PlanUsageCell({ window, now }: { window: PlanUsageWindow | null; now: number }) {
  // window が null なのは「その provider にこの枠が無い」ことを表す
  // (Codex は 5 時間枠を持たない)。取得できていない場合は行ごと別表示になる。
  if (!window) {
    return (
      <span className="plan-usage-window">
        <span className="plan-usage-percent">—</span>
        <span className="plan-usage-remaining">—</span>
      </span>
    );
  }
  const percent = Math.round(window.usedPercent);
  return (
    <span className="plan-usage-window">
      <span className={`plan-usage-percent${percent >= 80 ? " high" : ""}`}>{percent}%</span>
      <span className="plan-usage-remaining">
        {window.resetsAt === null ? "—" : formatRemaining(window.resetsAt - now)}
      </span>
    </span>
  );
}

function unavailableLabel(state: "logged-out" | "no-plan-limits" | "failed"): string {
  switch (state) {
    case "logged-out":
      return "not logged in";
    case "no-plan-limits":
      return "no plan limits";
    case "failed":
      return "unavailable";
  }
}

function rowTitle(usage: ProviderPlanUsage): string {
  if (usage.state !== "ok") {
    return `${providerLabel(usage.provider)} · ${unavailableLabel(usage.state)}`;
  }
  const parts = [
    resetTitle("5h", usage.fiveHour),
    resetTitle("7d", usage.weekly),
    `updated ${new Date(usage.fetchedAt).toLocaleTimeString()}`,
  ];
  return parts.filter((part) => part !== null).join(" · ");
}

function resetTitle(label: string, window: PlanUsageWindow | null): string | null {
  if (!window || window.resetsAt === null) {
    return null;
  }
  return `${label} resets ${new Date(window.resetsAt).toLocaleString()}`;
}
