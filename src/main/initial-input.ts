import { setTimeout } from "node:timers/promises";

// The TUI treats input arriving in one chunk as a paste and swallows an Enter
// included in it (observed suppression window ~120ms), so the message and the
// Enter must be separate writes with a gap.
const ENTER_DELAY_MS = 500;
const VERIFY_POLL_INTERVAL_MS = 500;
const VERIFY_TIMEOUT_MS = 10_000;

export interface InitialInputWriter {
  write(data: string): void;
}

export interface DeliverInitialInputOptions {
  // Confirms the provider recorded the message into its session store.
  // Delivery resolves true without verification when omitted.
  verify?: () => Promise<boolean>;
  enterDelayMs?: number;
  verifyPollIntervalMs?: number;
  verifyTimeoutMs?: number;
}

export async function deliverInitialInput(
  writer: InitialInputWriter,
  initialInput: string,
  options: DeliverInitialInputOptions = {},
): Promise<boolean> {
  writer.write(initialInput);
  await setTimeout(options.enterDelayMs ?? ENTER_DELAY_MS);
  writer.write("\r");

  if (!options.verify) {
    return true;
  }
  const deadline = Date.now() + (options.verifyTimeoutMs ?? VERIFY_TIMEOUT_MS);
  while (Date.now() < deadline) {
    if (await options.verify()) {
      return true;
    }
    await setTimeout(options.verifyPollIntervalMs ?? VERIFY_POLL_INTERVAL_MS);
  }
  return false;
}
