# D-132 — The preview routing state survives Service Worker eviction
**Status:** accepted (2026-11-09)

`ide/public/sw.js` is the single router between every IDE tab's preview and its kernel: a preview
frame is mapped to the tab that served its navigation, and a per-boot kernel token to that tab,
because two tabs' dev servers both bind the same in-VM port (upstream #23; issue #4). That state
lived only in the worker's memory, and Chrome terminates an idle Service Worker after ~30s; nothing
re-announces a page that is already open, and both tabs answer the same port with 200, so a reload
could silently paint the other tab's project — worst in a background tab, where the focus-ordered
`pickKernelClient()` guess lands on the wrong one.

**Decision.** Persist the routing maps and restore them on the first preview request after a revival:
- one blob at `https://vv.config/preview-routing` in the `vv-config` Cache Storage already used for
  keep-prefix and DevTools, written on frame recording, on `vv-kernel-host`, on a per-tab
  keep-prefix change and on a prune that removed something; writes are serialised and no request
  awaits them;
- `loadRouting()` reads it once per worker instance and is awaited by `resolveKernelSink` and by the
  tokened-navigation branch (which runs before there is a sink to ask); it never rejects, so a
  corrupt blob costs the fallback route, not every preview;
- client ids are stable across an SW restart, which is what makes the restore sound; a persisted
  route whose kernel client is gone is dropped by `pruneRouting` before it can be followed;
- the per-tab keep-prefix decision rides in the same blob, so a revived SW does not fall back to the
  last writer's global set (one tab may keep `/preview/<port>/` while the other strips it).

**Why the IDE copy.** `ide/public/sw.js` forks Vivari's `packages/studio/public/sw.js`; that package
is out of scope in the Vivari repository, so the canonical fix has to be carried here and re-applied
whenever the file is synced (the file header and AGENTS.md say so).

**Rejected.** Re-announcing from every server `listen` (what the old comments assumed: it does not
happen, and it would still lose the frame→tab mapping); a per-tab origin or port (one kernel origin);
trusting a persisted route blindly (it may name a closed tab).

**Consequences.** One cache entry and a few best-effort writes per preview document; a revived SW
restores routing before it looks anything up. The regression gate described in #4 (share one storage
map between two `loadSw` instances) belongs in the Vivari fork's SW spike; here the fix was verified
with that eviction scenario plus the existing vendor routing/multitab/isolation spikes.

**Verification.** The eviction scenario passes against the patched `ide/public/sw.js` — reload and
subresources reach the tab that served them, a fresh tokened navigation resolves, per-tab keep-prefix
survives, a dead route falls back and is pruned, a corrupt blob does not reject — and fails on the
pre-fix file with exactly the reported symptom (the reload after eviction is served by the other
tab). The pinned Vivari submodule's `spike-sw-multitab`, `spike-sw-routing` and
`spike-sw-isolation-policy` pass against the patched file, and `pnpm lint`, `pnpm typecheck`,
`pnpm test` and `pnpm build` are green.
