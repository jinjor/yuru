import { setTimeout } from "node:timers/promises";

// The TUI treats input arriving in one chunk as a paste and swallows an Enter
// included in it (observed suppression window ~120ms), so the message and the
// Enter must be separate writes with a gap.
const ENTER_DELAY_MS = 500;
const VERIFY_POLL_INTERVAL_MS = 500;
const VERIFY_TIMEOUT_MS = 10_000;
const BRACKETED_PASTE_START = "\u001b[200~";
const BRACKETED_PASTE_END = "\u001b[201~";

export interface InitialInputWriter {
  write(data: string): void;
}

export interface DeliverInitialInputOptions {
  // Confirms the agent recorded the message into its session store.
  // Delivery resolves true without verification when omitted.
  verify?: () => Promise<boolean>;
  enterDelayMs?: number;
  verifyPollIntervalMs?: number;
  verifyTimeoutMs?: number;
}

export function assertValidTerminalInput(input: string): void {
  const hasTerminalControlCharacter = Array.from(input).some((character) => {
    const codePoint = character.codePointAt(0)!;
    return (
      codePoint <= 0x08 ||
      (codePoint >= 0x0b && codePoint <= 0x1f) ||
      (codePoint >= 0x7f && codePoint <= 0x9f)
    );
  });
  if (hasTerminalControlCharacter) {
    throw new Error(
      "Initial prompts sent through a terminal may contain tabs and line feeds, but no other terminal control characters.",
    );
  }
}

export async function deliverInitialInput(
  writer: InitialInputWriter,
  initialInput: string,
  options: DeliverInitialInputOptions = {},
): Promise<boolean> {
  assertValidTerminalInput(initialInput);
  writer.write(`${BRACKETED_PASTE_START}${initialInput}${BRACKETED_PASTE_END}`);
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
