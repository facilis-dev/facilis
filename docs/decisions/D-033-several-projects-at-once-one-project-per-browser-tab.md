# D-033 — Several projects at once: one project per browser tab
**Status:** accepted (2026-10-29)

The last engine-level gap for an IDE people can live in: two projects side by side. A browser
tab is the unit — the same project in two tabs is refused, different projects each get their own
tab, kernel, dev server and preview.

**Measured (2026-10-29, one React project + one Vue project, two tabs on one origin).** Two
kernels coexist with no engine change: each tab boots its own VM (the second tab's
`kernel-online` is +2.5-2.9 s because it restores the shared tree), each dev server binds 5173
in its own VM, and the pair costs ~355 MB + ~362 MB of JavaScript/worker memory (~0.7 GB), against
an 11 GB storage quota (308 MB OPFS, shared by both). The constraint was never "can two kernels
run": it was two pieces of per-origin state written as if one kernel existed.

- **Preview routing was per origin, not per kernel.** The Service Worker picked "the window that
  hosts a kernel" and posted every `/preview/<port>/` request there. Both tabs announce
  themselves, both run a server on 5173, and the second tab to boot won the lookup: measured, a
  `fetch('/preview/5173/')` from tab A returned tab B's app, and reloading tab A's preview
  painted tab B's project. Fixed in `sw.js` (upstream #23, released in v1.1.5): a navigation is
  attributed to the window that started it (`event.clientId`) and the frame it creates is
  recorded under `event.resultingClientId`, so every later subresource of that frame goes back to
  the same kernel. The follow-up measured the assumption Chrome 156 breaks: a frame's *first*
  navigation carries an **empty** `clientId`, so the bridge now puts its per-boot kernel token in
  same-origin preview URLs (`__vv_kernel`), the SW records the resulting frame against that tab
  and redirects the token away (`resultingClientId` survives the redirect), and the routing maps
  are pruned of clients that are gone. keep-prefix ports became per kernel
  (`keepPrefixByClient`) and ws/SSE tunnel frames are scoped to the kernel's own preview windows.
- **The OPFS mirror's index was rewritten from one kernel's memory.**
  `vv-vfs/manifest.json` is per origin; each tab wrote the whole index from the paths it happened
  to know. Measured: with both tabs running, one write in tab A dropped every one of tab B's paths
  from the index (`beta` entries 10 → 0) and reloading tab B lost the project (`vv-stat` →
  does not exist). Fixed in `opfs-persistence.js` (upstream #22, released in v1.1.5): the index
  write is a read-merge-write of *this kernel's* changed paths under a `vv-vfs-manifest` Web Lock,
  so two tabs cannot interleave it. The follow-up closed two gaps the test exposed: the batch of
  changed paths is taken before the write's first `await` (a path recorded mid-write was lost for
  good), and `restore()` reads the index under the same lock (a sync access handle held by a
  booting tab could make another tab's `move()` and its copy fallback both fail). Our
  `hydrate()` takes the lock too.

**Decision:** tabs are the unit of work, and the Studio enforces one project per tab.

- Each open workspace folder is claimed with a Web Lock (`facilis-project:<rootPath>`), released
  when the folder closes or the document goes away. A folder already claimed by another live tab
  is closed again and a toast says why — two RAM copies of one project would diverge and then
  mirror over each other.
- A tab opened from another one carries `?project=<rootPath>`: on boot it opens **and runs** that
  project, so F5 lands back on it instead of Home. The parameter is dropped when the tab loses its
  project; a tab that started on Home stays parameterless.
- "Open in a new tab" is on each Home recent-project row, and the title bar gains a "New tab"
  button (Home in a fresh tab, other boot params such as `?net=` preserved).
- The browser title names the project (`alpha — Vivari Studio`), so tabs are distinguishable.

**Deliberately not done:** per-project OPFS namespaces. Partitioning the store by project would
cut the second tab's restore time and memory, but it makes the project→store mapping a *boot*
parameter, which rewrites the Home → open flow, the create flow and the multi-root workspace — a
large refactor for a feature that already fits. The shared tree costs one restore per tab
(measured 2.5-2.9 s for the two-project tree) and one RAM copy per tab; revisit only if that grows
with real projects.

**Known limitation:** two tabs installing at the same time can lose one snapshot entry in the
dependency cache's own index (the blob stays on disk, the index entry does not). The next install
of that project re-creates it: wasted bytes, not corruption. The VFS mirror is not affected.
Acceptance: `pnpm ide:smoke:multitab` (D-033's four properties), the two existing smokes
(unchanged), and the fork pins.

**Amended 2026-10-30 (D-035):** the tab unit is now strict — a tab holds exactly one project
root (opening another replaces it), and the label is the workspace folder's name, not a stored
title.
