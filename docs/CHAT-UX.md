# Chat UX direction (planned)

**Status:** **partly implemented (2026-11-08/09)** — the lighter transcript (D-114), pasted
screenshots (D-113) and context compaction (D-133) landed; the project-file picker remains
planned. Tracked as O-018 in [DECISIONS.md](./DECISIONS.md); this file is the sketch to act on.

The owner's reference is the harness's own session view (DeepSeek Harness): the same chat content
we already have, but **much lighter** — a dense, chronological transcript instead of a stack of
bordered cards.

## What "lighter" means here

- One collapsed line per step, icon left, one-line meta right:
  `Think · <first words of the reasoning>`, `Code · <what the call was for>`,
  `Edit file.ts 2 KB`, `Read file.md`, `Bash <command>`.
- A click expands that line into the existing detail (reasoning text, program, tool arguments,
  diff), exactly like our `<details>` rows but without the card chrome: no rounded boxes, no
  hairline borders per row, 11–12 px type, muted meta, generous line-height.
- Assistant prose stays a plain block, not a bubble; the transcript reads top-to-bottom in
  strict time order (D-110 already does this for model calls and programs).
- The composer keeps the current behaviour; the transcript is where the density work is.

**Landed (2026-11-08, D-114).** The trace rows lost their card chrome (`ChatTraceView.tsx`: icon,
title, status and a right-aligned mono meta on one line; expanding keeps the reasoning, program
and tool rows), and the assistant's prose is a plain full-width block (`ChatMessageView.tsx`);
the user's message is a quiet bubble on the right. The composer only gained the paste path
(D-113).

## Requested functions

### "Compact"

**Owner decision (2026-11-07): "compact" means context compaction**, not a density switch.

1. **Context compaction (chosen; landed 2026-11-09, D-133).** A `/compact`-style action that asks
   the model to summarize the conversation so far into one replayable summary message and then
   drops the raw history *from the replay* (the visible transcript stays). Only the last
   `HISTORY_LIMIT = 20` messages are replayed (`chat-session.ts`), and the visible transcript
   already survives longer than that; compaction helps very long sessions and costs one model
   call. Built as a header action (`chat.compact`, idle-only) with a `compacting` phase reusing
   the Stop/cancel path; the summary lives in `ChatState.summary` and the transcript shows an
   expandable marker where the covered prefix ends.
2. **Density (not "compact"):** the lighter visual style above remains the goal of this document,
   but it is a separate visual slice — no persisted toggle is planned under the name "compact".

### Attachments

- Composer "+" opens a project-file picker (the same list the explorer shows). The message carries
  the **paths**, not the content: the model reads them with the PTC tools (`read_file`, `search`),
  consistent with the "no file stuffing" direction (D-101/D-102).
- **Pasted screenshots (landed 2026-11-08, D-113):** Ctrl+V in the composer turns the
  clipboard's image files into data URLs (PNG/JPEG/WebP/GIF, ≤12 MiB source, ≤4 per message),
  downscaled to a 1536 px longest edge and re-encoded as JPEG q0.85 before they are kept, shown
  as thumbnails above the composer and on the user's bubble, replayed with the conversation and
  sent to the model only for a `vision` preset. Nothing is written to the project and nothing is
  persisted; a new chat drops any pending image.
- Files dragged from the OS: later; text files would be read client-side with a size cap, and
  images only when the provider model supports vision — the multimodal message format exists now
  (D-112: `preview_screenshot` and `AiChatTurn.images`), so the remaining work is the composer
  entry point and the file reading.
- Attachments must stay display-only for the model unless a tool reads them: nothing here writes
  to the project.

## What it touches when we do it

- **Landed:** `ChatPanel` (header compact action + busy label), `chat-session.ts` /
  `chat-compaction.ts` (summarization call, `ChatSummary`, replay swap), `ChatSummaryView.tsx`
  (the marker row), i18n keys (en/it) and tests.
- **Still planned:** the composer "+" project-file picker, with its screenshot acceptance pass on
  the real IDE (compaction currently has unit, typecheck, theme and i18n coverage only).

## Status

Partly landed (2026-11-08/09): the lighter transcript (D-114), pasted screenshots (D-113) and
context compaction (D-133). The preview tools landed first (D-111); the remaining chat slice is
the project-file picker ("+").
