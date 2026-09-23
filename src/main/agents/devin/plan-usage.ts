import type { PlanUsage } from "../agent.js";
import type { ResolvedAgentCommand } from "../command.js";
import { runPlanUsageCommand } from "../plan-usage-io.js";

const TIMEOUT_MS = 10_000;

// devin has no local endpoint for plan-window usage; the only account check the
// CLI offers is `devin auth status`. It prints "Logged in ..." or
// "Not logged in." and exits 0 either way, so the answer comes from stdout.
export async function loadDevinPlanUsage(command: ResolvedAgentCommand): Promise<PlanUsage> {
  const output = await runPlanUsageCommand(command, ["auth", "status"], TIMEOUT_MS);
  if (/not logged in/i.test(output)) {
    return { state: "logged-out" };
  }
  if (/logged in/i.test(output)) {
    return { state: "no-plan-limits" };
  }
  throw new Error("devin auth status returned an unreadable response");
}
