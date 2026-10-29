# PR draft — fix(preview): route each preview request to the kernel that owns it

**PR:** [#23](https://github.com/maitrungduc1410/vivari/pull/23) (opened 2026-10-29). Branch
`fix/preview-per-tab-kernel` on `kele23/vivari`, based on `v1.1.4` (`8e91ade`); commit
`740afb2`. The same change applies with `git am docs/upstream/vivari-preview-per-kernel.patch`
(includes the changeset).

**Base repo:** [maitrungduc1410/vivari](https://github.com/maitrungduc1410/vivari)

## Summary

`handlePreview` resolved ONE window that hosts a kernel and posted every `/preview/<port>/`
request there. That is correct while an origin has a single Vivari kernel, and stops being
correct the moment two Studio tabs are open: both announce themselves through `vv-kernel-host`,
both run a dev server on the same in-VM port (5173 in the common case), and the tab that booted
second wins the lookup. Every preview request, reload and websocket tunnel then belongs to the
wrong tab.

## Evidence (two real Chrome tabs, one origin, React in one and Vue in the other)

- A `fetch("/preview/5173/")` issued **by tab A** returned tab B's app (title `Vite + Vue`),
  as did the same fetch from tab B: both requests were answered by one kernel.
- Reloading tab A's preview painted **tab B's project** — the strongest form of the bug, and the
  one a user hits just by pressing reload.
- The two kernels themselves were fine: tab B's `kernel-online` at +2.9 s, both dev servers
  bound 5173 in their own VM, ~0.7 GB of worker memory for the pair, 308 MB of OPFS shared.

## Change

- Route on the requesting client. A navigation belongs to the window that started it
  (`event.clientId` — the Studio tab) and names the frame it creates (`resultingClientId`);
  remember that pairing in `frameKernel`, so later subresources of the frame (which name only
  the frame) resolve back to the same kernel. The old heuristic stays as the fallback for a
  client we cannot attribute, e.g. a revived SW that lost the in-memory map.
- keep-prefix ports are per kernel host (`keepPrefixByClient`), resolved after the sink is
  known: two tabs can legitimately disagree about the same port number. The persisted set stays
  as the fallback for a revived SW.
- ws/SSE tunnel frames are delivered to the kernel's own preview windows, and outbound frames
  from a preview tab go to the kernel that served it, instead of to whichever window matched
  first.

## Verification

- Two real tabs: each preview, each forced reload and each direct fetch stays on its own kernel.
- Single-tab is unchanged: the IDE's existing smokes (`React`, and the `Facilis` framework run)
  stay green, as does the new multi-tab smoke in the superproject.

## Notes

- Mode B (a separate preview origin, one kernel) is untouched: there is no client to
  disambiguate there and the persistent port is used as before.
- The map is in-memory on purpose. If the SW is evicted both tabs re-announce on their next
  `listen`, and the next navigation re-learns the frame's owner.

