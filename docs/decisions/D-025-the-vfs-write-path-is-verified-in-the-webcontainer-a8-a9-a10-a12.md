# D-025 — The VFS write path is verified in the WebContainer (A8/A9/A10/A12)
**Status:** accepted (2026-10-28, Phase 0 browser spike)

SPEC §14.1 items 4-7 now have a scripted, repeatable proof in
`scripts/dev/smoke-write.mjs` (run by `TEMPLATE=Facilis pnpm ide:smoke`), driving the real
Studio controller through the dev-only `window.__ide` handle:

- **A8 — `vivari.fs.writeFile`.** A kernel write lands in the VFS, shows up in the Explorer
  index and, once opened, in the editor. Saving an edited `src/App.tsx` hot-updates the
  preview **without reloading the preview document** (asserted by comparing
  `contentWindow.performance.timeOrigin` before and after), and writing a server route
  (`server/routes/api/ping.get.ts`) makes the in-VM Nitro handler answer with the new body —
  so the swapped Nitro-fronts-Vite arrangement keeps both HMR and server reload alive.
- **A9 — `vivari.fs.writeFiles`.** The kernel has no batch RPC (one `vv-write` per file), so
  the framework's batch is its own loop: `applyPatch()` (below). The check applies three
  files at once, asserts the files are readable through the VFS, that an unsafe path is
  rejected before any write, that a delete lands, and that editing `locales/en.json` moves
  `/__facilis/manifest/revision` — the write → manifest loop end to end.
- **A10 — isomorphic-git on the VFS.** `git init`, status over the working tree and a commit
  all succeed against the VFS through the existing `ScmSession` (SPEC §14.1 item 6).
- **A12 — reboot.** After a flush, a `Page.reload` restores the VFS from the OPFS mirror: the
  uncommitted probe file is readable again from the reloaded Studio.

**Durability fix found by A12.** `KernelBridge` only flushes the OPFS write-behind buffer on
`pagehide`, which a hidden, frozen or discarded tab may never receive.
`ide/src/vv/vfs-flush.ts` adds the SPEC §13 risk-9 mitigation: flush on
`visibilitychange` (plus `pagehide`), installed by `IdeProvider` because `controller.ts` is
pinned by the file-length ratchet.

**Where `applyPatch()` lives.** SPEC §10.2 names it as an `IdeController` method, but
`controller.ts` cannot grow (ratchet). It is therefore a function in
`ide/src/facilis/apply-patch.ts` taking the controller's bridge and folder root — which is
also what AGENTS.md asks for ("isolate Facilis changes in new modules"). It validates with
`@facilis.dev/ai`'s `validatePatch` before any write (security invariant 9), writes
sequentially through the kernel bridge (SPEC §10.3), and returns the refreshed manifest
revision. The read side is `ide/src/facilis/manifest-client.ts` (SPEC §6), throw-free
so a booting or broken project renders as "unreachable" instead of taking the editor down.

**Consequences:** Phase 0 browser items A8, A9 (as the framework write path), A10 and A12 are
closed with evidence. A11 (PAT modal + WebCrypto-encrypted clone) stays open: the Studio's git
layer is local-only today (SPEC §6.4/§10.4), so remote auth is Phase 2 work, not a missing
spike.
