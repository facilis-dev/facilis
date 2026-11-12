// The proposal card's write path (D-046/D-047): apply the accepted files, or undo a clean
// apply, and report the phase around the write.
//
// Split out of chat-session.ts, which sits at the 300-line limit. The session still owns the
// phases and the listeners: these functions mutate the chat state only through the injected
// emit, so the validated applyPatch() path stays the single write route (invariant 9).

import { applyAccepted, applyUndo } from "./chat-actions";
import { errorText } from "./chat-session-types";
import type { ChatHost } from "./chat-session-types";
import type { ChatState } from "./types";

/** Write the accepted files through the validated path. */
export async function applyProposal(
  host: ChatHost,
  state: ChatState,
  emit: (patch: Partial<ChatState>) => void,
): Promise<void> {
  const proposal = state.proposal;
  const root = host.root();
  if (!proposal || !root || state.phase !== "idle") return;
  if (!proposal.files.some((file) => file.accepted)) return;
  emit({ phase: "applying", error: null });
  try {
    const { applied, undo } = await applyAccepted(
      { bridge: host.bridge, root, manifestBase: host.manifestBase() },
      proposal,
      host,
    );
    emit({ phase: "idle", applied, undo, ...(applied.ok ? { proposal: null } : {}) });
  } catch (error) {
    emit({ phase: "idle", error: { kind: "stream", message: errorText(error) } });
  }
}

/** Put the last clean Apply back the way it was. */
export async function undoProposal(
  host: ChatHost,
  state: ChatState,
  emit: (patch: Partial<ChatState>) => void,
): Promise<void> {
  const undo = state.undo;
  const root = host.root();
  if (!undo || !root || state.phase !== "idle") return;
  emit({ phase: "applying", error: null });
  try {
    const applied = await applyUndo(
      { bridge: host.bridge, root, manifestBase: host.manifestBase() },
      undo,
    );
    emit({ phase: "idle", applied, undo: applied.ok ? null : undo });
  } catch (error) {
    emit({ phase: "idle", error: { kind: "stream", message: errorText(error) } });
  }
}
