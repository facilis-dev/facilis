# D-102 — Repair hardening: three corrections, per-file fix plan, canonical prompt shapes
**Status:** accepted (2026-11-07)

The first real PTC test surfaced two failures: the model's first script usually misused the
tools, and the two-correction budget sometimes ran out before a patch set was valid (one schema
rewrite produced several route findings, and each round fixed a symptom). The user asked for a
validation that works per file and repeats more often.

**Decision.**

- **Three corrections** after the first answer (`MAX_REPAIR_ATTEMPTS = 3`; `MAX_MODEL_CALLS`
  becomes 6 programs + 3 corrections + the answer = 10). The script budget is unchanged.
  (Superseded by D-108: the correction, part, program and call counters are all gone.)
- **Validation stays set-level; the feedback becomes per-file.** Per-file *validation* is not
  sound: the 16 rules include cross-patch rules (a route may reference a table added in the same
  set, a permission may be added to the config in the same set, a schema rewrite interacts with
  every existing route), so validating one file against the current project would report false
  errors. The repair report builds a **fix plan grouped by file, root cause first**
  (`db/schema.ts`/`facilis.config.ts` before route consequences, `destructive-confirmed` before
  its dependent findings), lists the files the rejected answer touched, and keeps the full
  numbered findings. The `validate` tool can still check candidate subsets while iterating.
- **Prompt hardening for the first-round failures:** canonical route and scoped-table shapes
  (copied from `examples/todo-app`), an exact script-turn example, "call every tool with one
  object argument", "the return value is the only data you receive: end with `return`", "no
  markdown fences inside the script", "read before re-emit", and the `validate`-before-answer
  rule. The response contract mentions the `script` alternative when the PTC section is present.
- **Self-correcting tool errors:** a refused call reaches the model as
  `<tool> <signature>: <reason>` (e.g. `read_file({ path, startLine?, endLine? }): path is
  required`); a program that returns nothing is reported with the `return` hint. The catalogue
  moves to `ide/src/ai/ptc/tool-specs.ts` to keep the router under the file-length limit.

**Rejected alternatives.** *Validate each patch in isolation*: false positives on the cross-patch
rules; the validator's contract is the resulting project. *Unbounded retries*: token cost; three
rounds plus a grouped plan cover the observed failures — **superseded by D-108**: the gate is
validity, so retries are unbounded and the counters are gone. *Native tool calling instead of PTC*:
out of scope (D-101).

**Consequences.** Worst case ten model calls per user message (superseded by D-108: no call cap,
no correction cap); the repair prompt gains a plan and a touched-file list, bounded by the
existing size caps. The final validator remains the only boundary
by design: the goal is that the model validates its own set first and the user rarely sees a
rejection.

**Verification.** `repair.test.ts` (root-cause ordering, plan, touched files, report cap),
`chat-session-repair.test.ts` (multi-correction until valid, role folding; D-108 removed the
attempt-count expectations),
`prompt.test.ts` (canonical shapes, object args, return rule, script contract),
`turn.test.ts` (no-value hint); full gates green.
