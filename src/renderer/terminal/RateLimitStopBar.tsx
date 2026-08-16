import type { RateLimitStop } from "../../shared/session";
import { providerLabel } from "../providers/providerLabel";

interface RateLimitStopBarProps {
  stop: RateLimitStop;
  onContinueWhenResetChange: (continueWhenReset: boolean) => void;
}

// 使い切っている枠がリセットされる時刻。今日中なら時刻だけ、日をまたぐなら日付も出す。
function formatResetsAt(resetsAt: number): string {
  const reset = new Date(resetsAt);
  const time = reset.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return reset.toDateString() === new Date().toDateString()
    ? time
    : `${reset.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
}

// rate limit で断られた所で止まっている session に出す。止まっている間だけ存在し、
// 解除されると消える。閉じる操作は無い。
export function RateLimitStopBar({ stop, onContinueWhenResetChange }: RateLimitStopBarProps) {
  return (
    <div className="rate-limit-stop-bar">
      <span className="rate-limit-stop-bar-state">
        {providerLabel(stop.provider)} limit reached
        {stop.resetsAt !== null && ` · resets ${formatResetsAt(stop.resetsAt)}`}
      </span>
      {stop.resetsAt === null ? (
        <span className="rate-limit-stop-bar-continue">Reset time unavailable</span>
      ) : (
        <label className="rate-limit-stop-bar-continue">
          <input
            type="checkbox"
            checked={stop.continueWhenReset}
            onChange={(event) => onContinueWhenResetChange(event.target.checked)}
          />
          Continue when the limit resets
        </label>
      )}
    </div>
  );
}
