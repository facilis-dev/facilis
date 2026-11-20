# D-022 — Facilis projects install with pnpm only, from IDE-served tarballs
**Status:** superseded by D-032 (2026-10-29); kept for the investigation it records

A generated Facilis project installs `@facilis.dev/*` from `pnpm pack` tarballs served by the
IDE origin, and it does so with **pnpm only**. Both halves are forced by the WebContainer,
not preferences:

- **Tarball delivery.** The packages were workspace-only when this decision was taken (O-006,
  resolved by D-164), so the template declares
  them as `http://host.vivari.internal:<studio-port>/vendor/facilis/facilis-<pkg>-0.0.0.tgz`.
  It cannot use the studio origin verbatim: the kernel's virtual network owns loopback, so
  `127.0.0.1:<port>` inside the VM is the VM, and npm/pnpm get `ECONNREFUSED`. The kernel's
  documented host alias is rewritten to the studio hostname in the browser before the fetch.
- **pnpm, not npm.** npm 10 builds its HTTP agent with `agent-base`, whose custom
  `createConnection` makes the runtime decline the fetch-backed egress path for plain-http
  requests (`internal/http-egress` only egresses when the agent is the stock one). npm then
  dials the virtual network and fails with `ENOTFOUND` for the tarball URLs — reproduced in
  npm's own debug log, while `https://registry.npmjs.org` traffic is unaffected. pnpm's fetch
  uses the stock agent, reaches the alias, and installs. The template therefore runs
  `pnpm install`, ships a `preinstall` guard that fails under any other package manager, and
  sets `packageManager: "pnpm@9.15.9"` (the vendored `pnpm-pack.bin`).
- **`node-linker=hoisted`.** The isolated link farm hides packages that Nitro's shipped dist
  imports without declaring (D-024), and hoisted linking gives the flat layout the VM module
  resolver expects. The template pins those packages itself.

**Consequences:** the generated project is pnpm-only by design and its README says so; npm
inside the VM remains broken for plain-http URL dependencies until upstream fixes the egress
split (a vendor change, not ours). The kernel's dependency cache is namespaced per package
manager and snapshots `node_modules` by package.json hash, so a **second Facilis project in
the same browser restores it in one blob instead of reinstalling** — the cross-project cache
this decision leans on. Each headless smoke run still starts from a fresh profile, so it pays
a cold install (prebuilt `vendor/depcache` is the later optimisation). Switching `@facilis.dev/*`
to published packages changes the dependency specs only; pnpm stays the installer.
