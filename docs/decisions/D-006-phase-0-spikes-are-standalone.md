# D-006 — Phase 0 spikes are standalone
**Status:** accepted (2026-10-25)

Feasibility spikes live in `spikes/<name>/` and are **not** pnpm-workspace packages
(installed with `pnpm install --ignore-workspace`). They prove assumptions before
framework code depends on them (spec §12 Phase 0, §14.1). The Phase 0 spike was retired on 2026-11-01 once D-007 and D-008 were implemented; this entry stays the rule for future spikes.
