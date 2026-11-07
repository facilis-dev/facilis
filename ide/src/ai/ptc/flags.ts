// Rollout gate for the PTC tool runtime (D-101, docs/PTC.md §12).
//
// Phase 1 is dev-only: the trace UI and the eval corpus must land before the runtime can be
// default-on, and a managed deployment needs the per-path CSP header first. Tests inject a
// runner directly, so they do not depend on this flag.
export const PTC_ENABLED = import.meta.env.DEV;
