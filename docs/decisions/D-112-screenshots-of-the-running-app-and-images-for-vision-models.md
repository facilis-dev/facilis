# D-112 — Screenshots of the running app, and images for vision models
**Status:** accepted (2026-11-07)

Some failures are visual or layout-level, and the preview tools (D-111) only returned text. The
owner asked for screenshots as part of the running-app inspection.

**Decision.**

- chobitsu already implements `Page.startScreencast`: it renders the page with html2canvas and
  emits `Page.screencastFrame` (base64 JPEG + metadata). `PreviewCdp.captureScreenshot()` starts
  the screencast, waits for one frame (2.5 s cap, `null` on timeout) and stops it; the frame
  becomes a `data:image/jpeg;base64,…` URL.
- `preview_screenshot()` captures one screenshot per call (at most 2 per program). The image is
  attached to the program's activity row (the user sees it, clickable) and to the tool-result
  user turn.
- Images travel only for a preset that declares `vision` (Anthropic, OpenAI and DeepSeek — see
  the update below; OpenRouter auto and Custom do not). `providers.ts` builds the protocol's
  content parts —
  `image_url` for OpenAI-compatible, `image` + base64 source for Anthropic — and otherwise keeps
  the plain string content, so a text-only model never receives a content array it cannot parse.
- `AiChatTurn.images?: string[]` carries data URLs into the wire; `ChatTraceRun.images` carries
  them into the transcript. The turn loop drains `host.preview.takeImages()` after each program
  and attaches them to that program's result turn.
- Nothing is persisted or replayed: images live for the turn (and in the visible row) only; a new
  user message starts from the text transcript.

**Rejected alternatives.** *A new screenshot dependency*: chobitsu's html2canvas path already
ships in the injected backend. *Sending images to every preset*: a text-only endpoint rejects the
request or swaps in a placeholder; the preset decides. *Persisting screenshots in the
conversation*: they would bloat the replay and the provider context; the row keeps them visible,
the model only needs the current turn.

**Consequences.** The model can see a rendered page (through a vision model) and the user always
sees the screenshot in the activity row; a text-only provider still records the capture but not
the pixels. The capture is html2canvas-quality: no canvas/video/iframe content, CSS shadows may
render approximately, and it takes up to ~2.5 s (inside the 5 s program budget).

**Update (2026-11-08) — DeepSeek reads images, and the DevTools backend cannot take a better
photo.** DeepSeek V4.1 Flash accepts image parts on both aliases (`deepseek-chat` resolves to
`deepseek-flash`); verified live against `/v1/chat/completions` (a red PNG answered "Red", 197
prompt tokens) and against `/v1/models`, which lists `input_modalities: ["text","image"]` for
`deepseek-flash` and text-only for `deepseek-v4-pro` (which replaces the image with a
`[Unsupported Image]` placeholder). The `deepseek` preset therefore declares `vision: true`;
screenshots now reach the model there too.

The preview's "DevTools" are chobitsu, an in-page reimplementation of CDP, not the browser's
own protocol: its `Page` domain implements `startScreencast` (html2canvas, SVG
`foreignObject`, scale 1) and has no `Page.captureScreenshot`; and a web page has no native
capture API at all (only `getDisplayMedia`, which needs a user permission prompt). So CDP cannot
yield a sharper or more faithful photo than the screencast frame the pipeline already uses — a
higher-resolution capture would mean a second renderer in the page, not a DevTools call.

**Verification.** `preview-cdp.test.ts` (screencast frame, timeout, stop), `provider.test.ts`
(OpenAI/Anthropic image parts), `provider-vision.test.ts` (DeepSeek image part, a preset without
`vision` drops them), `turn.test.ts` (images on the result turn and the onScript callback),
`chat-trace.test.ts` (images on the run row), `preview-tools.test.ts` (screenshot handler);
gates green.
