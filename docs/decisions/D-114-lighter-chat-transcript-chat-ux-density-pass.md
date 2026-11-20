# D-114 — Lighter chat transcript (CHAT-UX density pass)

**Status:** accepted (2026-11-08)

With the composer changing anyway, the owner asked for the chat's graphic direction from
[CHAT-UX.md](./CHAT-UX.md): "sistema anche la grafica della chat come da istruzioni".

**Decision.**

- `ChatTraceView` drops the card chrome: one `<details>` line per step — icon left, title and
  status, right-aligned monospace meta — 11–12 px type, `hover:bg-muted/40`, expanding into the
  existing reasoning / program / tool rows. Model calls carry the brain icon, programs the
  terminal icon, and the running step spins. D-110's behaviour is unchanged: the running call
  and the latest call stay open, and the timeline stays strictly chronological (call → program →
  call).
- `ChatMessageView` makes the assistant's prose a plain full-width block (no bubble) and the
  user's message a quiet `bg-muted/70` bubble on the right; pasted images (D-113) render above
  the text.
- `ChatPanel` keeps its layout: the single scrolling transcript, the out-of-list busy status line
  and the error box are unchanged.

**Rejected alternatives.** *Collapsing the detail away*: the expanded row is the only place the
reasoning, the program and the tool results stay visible. *A density toggle*: the owner chose one
lighter style, not a switch (same reasoning as the "compact" definition in CHAT-UX).

**Consequences.** The transcript reads top-to-bottom like the harness's session view and fits more
steps per screen. Presentation only: no state, wire or contract changes.

**Verification.** Typecheck, lint, format and build; the transcript is covered indirectly through
`ChatSession` state (no component test harness exists in the repo) and a visual pass in the IDE.
