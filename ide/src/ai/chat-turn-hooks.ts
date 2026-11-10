// The ChatSession ↔ runTurn wiring (D-110): status lines, exploration rows and model-call
// activity. Kept here so the session class (at the 300-line limit) only passes its state.
//
// The callbacks read the session's *current* state through TurnSurface: a closure over the
// state object would go stale, because the session replaces it on every emit.

import {
  appendReasoning,
  beginTraceCall,
  beginTraceRun,
  completeTraceCall,
  completeTraceRun,
} from "./chat-trace";
import type { TurnInput } from "./turn";
import type { ChatActivity, ChatState } from "./types";

/** What the hooks need from ChatSession (closed over, so the session stays the owner). */
export interface TurnSurface {
  trace(): readonly ChatActivity[];
  reasoning(): string | null;
  emit(patch: Partial<ChatState>): void;
  dropStream(): void;
}

export type TurnHooks = Pick<
  TurnInput,
  "onRepair" | "onScriptStart" | "onScript" | "onPatches" | "onReasoning" | "onCallStart" | "onCall"
>;

export function turnHooks(surface: TurnSurface): TurnHooks {
  const status = (patch: Partial<ChatState>): void => {
    surface.dropStream();
    surface.emit(patch);
  };
  return {
    onRepair: (attempt) => status({ repair: { attempt }, patchParts: null }),
    // An exploration answer is not the turn's answer: drop its partial bubble, so its prose
    // never renders above the program that followed it (the call row records the call).
    onScriptStart: (program, programNumber) =>
      status({ exploring: programNumber, trace: beginTraceRun(surface.trace(), program) }),
    onScript: (result, program, images) =>
      surface.emit({
        exploring: null,
        trace: completeTraceRun(surface.trace(), result, program, images),
      }),
    onPatches: (part) => status({ patchParts: { part } }),
    // The running call row is inserted where the call starts, so the reasoning that streams
    // next renders inside that row instead of above the whole timeline (D-110).
    onCallStart: (call) =>
      surface.emit({ reasoning: null, trace: beginTraceCall(surface.trace(), call) }),
    onReasoning: (chunk) =>
      surface.emit({ reasoning: appendReasoning(surface.reasoning(), chunk) }),
    onCall: (call) => surface.emit({ trace: completeTraceCall(surface.trace(), call) }),
  };
}
