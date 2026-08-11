import type { GitLineStat } from "../../shared/ipc";

export function LineStatLabel({ lineStat }: { lineStat: GitLineStat }) {
  if (lineStat.added === 0 && lineStat.deleted === 0) {
    return null;
  }
  return (
    <span className="line-stat">
      {lineStat.added > 0 && <span className="line-stat-added">+{lineStat.added}</span>}
      {lineStat.deleted > 0 && <span className="line-stat-deleted">-{lineStat.deleted}</span>}
    </span>
  );
}
