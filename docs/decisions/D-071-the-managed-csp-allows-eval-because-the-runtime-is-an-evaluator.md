# D-071 — The managed CSP allows eval, because the runtime is an evaluator
**Status:** accepted (2026-11-01)

[MANAGED-DEPLOYMENT.md](./MANAGED-DEPLOYMENT.md) §5 drafted a CSP without \`unsafe-eval\`; the
spike (§12) measured the opposite: under that policy the Studio boots and a project is
created, then the VM never evaluates and the preview never paints. The kernel compiles and
runs the project's code with \`new Function\` - the requirement is documented in
\`vendor/vivari/packages/runtime/module.js\` - and its workers inherit the page's policy.

**Decision.** The generated CSP keeps \`script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'\`.
No directive scopes eval to the VM alone, and the portable alternative - serving the kernel's
worker chunks with their own headers - needs per-path rules on hashed asset names, which the
hosts we document (nginx, Caddy, Cloudflare Pages) do not all express the same way; it stays
an optional tightening, not the default.

**Consequences.** L2 keeps its hard guarantees for *network* - \`connect-src\`, \`frame-src\`,
worker origins, no remote scripts - and no longer claims to prevent eval. That is honest: the
CSP was never a code-integrity control, since the project's code is supposed to run inside the
VM, and its supply is constrained by the registry mirror, \`packages.allow\`, admission and the
AI/provider policy (D-063, D-064, D-066). A deployment that cannot accept eval cannot run
projects in the browser at all, so the option is not offered as a configuration switch.
Verified 2026-11-01 in Chromium: CSP + \`unsafe-eval\` reproduces the unrestricted run exactly.
