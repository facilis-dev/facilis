# D-113 — Images pasted into the chat (Ctrl+V)

**Status:** accepted (2026-11-08)

D-112 carried images only for the AI's own preview screenshots. The owner wants the user's own
screenshot in the conversation: "l'utente in caso se la scatta da solo… importante che sia
possibile inserirla tramite ctrl+v dentro la chat". CHAT-UX (O-018) had listed OS images as a
later items of the attachments slice.

**Decision.**

- Ctrl+V in the composer reads the clipboard's image files (only `image/png`, `image/jpeg`,
  `image/webp`, `image/gif`; 12 MiB per file, at most 4 images per message). `ide/src/ai/chat-image.ts`
  owns the reading and the caps; `ChatComposer.tsx` owns the pending thumbnails, the remove
  button and the skipped-files notice.
- Every image is downscaled and re-encoded before it joins the conversation
  (`ide/src/ai/chat-image-resize.ts`): longest edge 1536 px, JPEG q0.85, transparent pixels drawn
  on white; the smaller of the JPEG and the original wins, so an already-small image is never
  inflated. The generous source cap exists only because the copy that travels is the compressed
  one — a Retina screenshot lands around 100–300 KB instead of several megabytes, which matters
  because replay resends it with every later message.
- The data URLs ride on `ChatMessage.images` and `AiChatTurn.images`; D-112's wire path
  already turns them into the protocol's content parts, and only a preset that declares
  `vision` serializes them — the composer warns (`chat.image.noVision`) when the current
  provider does not.
- `replayTurns` keeps image-only messages (a paste with no text is a valid message) and merges
  the images of folded consecutive user turns, so the screenshot stays with the conversation.
  Nothing is written to the project and nothing leaves the in-memory session.
- A message with neither text nor images is still ignored, and a new chat remounts the composer,
  dropping any pending attachment.

**Rejected alternatives.** *A file picker or drag-and-drop now*: paste is the owner's explicit
path (the picker belongs to the project-file attachment slice). *Sending the raw paste*: a 4 MB
PNG replayed on every later message is waste the provider does not pay back — the canvas
downscale is a few lines and an order of magnitude. *A server-side/transform pipeline*: the IDE
is browser-only and the canvas is already there. *Persisting the images*: the conversation is
memory-only as before; localStorage would carry multi-megabyte data URLs into the origin's
quota.

**Consequences.** A pasted screenshot costs image tokens on the turn that carries it (and again on
later messages, because replay keeps it) and reaches the model only for a `vision` preset. The
16-rule validator is untouched: images never reach disk.

**Verification.** `chat-image.test.ts` (data URL, type/size caps, clipboard order, per-message
cap, undecodable file skipped), `chat-image-resize.test.ts` (the scale that fits the longest
edge), `chat-session-images.test.ts` (image-only message, replay, folding merge, empty message
ignored), `provider-vision.test.ts` (wire parts), i18n parity; gates green.
