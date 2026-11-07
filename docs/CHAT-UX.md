# Chat UX direction (planned)

**Status:** **planned** — owner direction 2026-11-07, not implemented. Tracked as O-018 in
[DECISIONS.md](./DECISIONS.md); this file is the sketch to act on later.

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

## Requested functions

### "Compact"

**Owner decision (2026-11-07): "compact" means context compaction**, not a density switch.

1. **Context compaction (chosen).** A `/compact`-style action that asks the model to summarize the
   conversation so far into one replayable summary message and then drops the raw history. Today
   only the last `HISTORY_LIMIT = 20` messages are replayed (`chat-session.ts`), and the visible
   transcript already survives longer than that; compaction helps very long sessions and costs one
   model call. It needs a summary message in `ChatState`, a command/settings surface, a way to
   keep the summary while the tool trace stays visible, and tests.
2. **Density (not "compact"):** the lighter visual style above remains the goal of this document,
   but it is a separate visual slice — no persisted toggle is planned under the name "compact".

### Attachments

- Composer "+" opens a project-file picker (the same list the explorer shows). The message carries
  the **paths**, not the content: the model reads them with the PTC tools (`read_file`, `search`),
  consistent with the "no file stuffing" direction (D-101/D-102).
- Files dragged from the OS: later; text files would be read client-side with a size cap, and
  images only when the provider model supports vision (the current multimodal message format does
  not exist yet — it is the second half of the preview-tools work, where the model may also see
  screenshots).
- Attachments must stay display-only for the model unless a tool reads them: nothing here writes
  to the project.

## What it touches when we do it

- `ChatPanel` (composer "+", compact command), `chat-session.ts` (compaction call and summary
  message, attachments preamble), `ChatMessageView` / `ChatTraceView` (density), i18n keys
  (en/it), tests and a screenshot acceptance pass on the real IDE.

## Status

Not started. The preview tools landed first (D-111); the next chat slice is context compaction
(chosen meaning of "compact"), then the attachments, then the visual density pass.
