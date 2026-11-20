# D-187 — The chat follows only while the reader is at the bottom
**Status:** accepted (2026-11-14)

**Context.** The transcript auto-scrolled on every change to the turn — including each reasoning
token, which is an effect dependency — so reading the thinking while it streamed was impossible:
the view jumped back to the newest line on every chunk. The busy bar and the reasoning rows were
already outside the scroll; the scrolling itself was the problem.

**Decision.** The panel follows new content only while the reader is within 24 px of the end
(`isAtBottom`, pure and unit-tested) and the explicit lock is off. Scrolling up pauses following;
scrolling back to the end resumes it; the header pin freezes it at any position and the pill over
the transcript jumps to the latest activity and resumes. A conversation switch resets to following.
There is no persisted preference: each session starts at the bottom.

**Consequences.** Reading reasoning during a turn no longer fights the transcript, and anything
that lands while the reader is away leaves the pill instead of yanking the view. The lock is
per conversation in memory only, so a reload returns to following; a persisted preference would be
a settings entry, which this decision does not add.
