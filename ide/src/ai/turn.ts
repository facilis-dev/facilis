// The SPEC §9.4 turn loop: ask the model, validate, and ask it to correct a rejected answer.
//
// Kept out of ChatSession (which owns the visible conversation) so the control flow is
// unit-testable and the session stays under the 300-line limit. The loop never writes to
// the project: it returns either a parsed answer or the failure the chat shows.

import type { CallModelInput, CallModelResult } from "./client";
import type { PatchValidationHost } from "./patch-validation";
import { buildRepairMessages, formatFailure, MAX_REPAIR_ATTEMPTS } from "./repair";
import { parseTurn, type AiParseFailure, type AiParseResult } from "./response";
import type { AiChatTurn, AiSettings, ChatFailure } from "./types";

export interface TurnInput {
  call: (input: CallModelInput) => Promise<CallModelResult>;
  settings: AiSettings;
  system: string;
  /** The replayed conversation, ending with the new user turn. */
  messages: readonly AiChatTurn[];
  host: PatchValidationHost;
  signal: AbortSignal;
  onText: (chunk: string) => void;
  /** Called before each correction request with the 1-based attempt and the cap. */
  onRepair: (attempt: number, max: number) => void;
}

export type TurnOutcome =
  | { ok: true; parsed: Extract<AiParseResult, { ok: true }> }
  | { ok: false; failure: ChatFailure };

/** Keep the provider's alternating-role requirement even when a repair turn is merged. */
function appendTurn(turns: AiChatTurn[], turn: AiChatTurn): void {
  const last = turns.at(-1);
  if (last !== undefined && last.role === turn.role) {
    last.content = last.content + "\n\n" + turn.content;
    return;
  }
  turns.push(turn);
}

/** An analyzer outage cannot be fixed by the model, so a repair round would be wasted. */
function isInternalFailure(failure: AiParseFailure): boolean {
  return (
    failure.findings.length > 0 &&
    failure.findings.every((finding) => finding.rule === "project-analysis")
  );
}

export async function runTurn(input: TurnInput): Promise<TurnOutcome> {
  const turns: AiChatTurn[] = [...input.messages];
  for (let attempt = 0; ; attempt += 1) {
    const result = await input.call({
      settings: input.settings,
      system: input.system,
      messages: turns,
      signal: input.signal,
      // Only the first answer streams: a rejected attempt's bubble is dropped anyway, and
      // the repair status line already tells the user what is happening.
      ...(attempt === 0 ? { onText: input.onText } : {}),
    });
    if (!result.ok) return { ok: false, failure: result.failure };

    const parsed = await parseTurn(result.text, input.host, { signal: input.signal });
    if (parsed.ok) return { ok: true, parsed };

    if (attempt >= MAX_REPAIR_ATTEMPTS || isInternalFailure(parsed)) {
      return { ok: false, failure: { kind: "parse", message: formatFailure(parsed) } };
    }
    const next = attempt + 1;
    input.onRepair(next, MAX_REPAIR_ATTEMPTS);
    const repair = await buildRepairMessages({
      failure: parsed,
      attempt: next,
      max: MAX_REPAIR_ATTEMPTS,
      read: input.host.read,
    });
    for (const turn of repair) appendTurn(turns, turn);
  }
}
