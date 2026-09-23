import type { PlanUsage } from "../agent.js";
import type { ResolvedAgentCommand } from "../command.js";
import { runPlanUsageCommand } from "../plan-usage-io.js";

const TIMEOUT_MS = 10_000;

// devin has no local endpoint for plan-window usage; the only account check the
// CLI offers is `devin auth status`. It prints "Logged in ..." or
// "Not logged in." and exits 0 either way, so the answer comes from stdout.
// Quotas exist (daily/weekly), they are just not readable — that is
// "unavailable", not "no-plan-limits".
export async function loadDevinPlanUsage(command: ResolvedAgentCommand): Promise<PlanUsage> {
  const output = await runPlanUsageCommand(command, ["auth", "status"], TIMEOUT_MS);
  if (/not logged in/i.test(output)) {
    return { state: "logged-out" };
  }
  if (/logged in/i.test(output)) {
    return { state: "unavailable" };
  }
  throw new Error("devin auth status returned an unreadable response");
}
