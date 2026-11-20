# D-072 — The default build ships a baseline CSP too
**Status:** accepted (2026-11-01)

The first CSP was scoped to managed builds, because only a deployment with a policy had
origins to name. That left the default build - the one facilis.dev serves and almost everyone
runs - with nothing beyond COOP/COEP, so its tab could load remote scripts and frames. Being
"unrestricted" as a *product* is not the same as being unhardened as a *document*.

**Decision.** \`renderHeaders\` emits a CSP for both profiles. Managed encodes the deployment
policy (§5); open carries this baseline:

\`\`\`
script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval' 'sha256-…';
worker-src 'self' blob:; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob:;
connect-src 'self' https: wss: ws: blob: data:;
frame-src 'self'; base-uri 'none'; object-src 'none';
\`\`\`

The network stays open because that profile is documented as unrestricted: arbitrary
repository imports, AI presets and custom base URLs, the opt-in loopback relay. Narrowing it
would be a new product policy, not a baseline.

Inline scripts are hashed by the build itself: \`vite.deployment.ts\` reads the built
\`index.html\` and turns every inline script into a \`sha256-\` source. That keeps the pre-paint
theme script working, and it fixed the managed build too, which was missing that hash.

**Consequences.** Open stays behaviourally identical - every directive is a permission, not a
requirement - while the cheapest remote-code and clickjacking vectors are gone. A deployment
that needs the hard boundary still picks managed; an operator who wants no CSP at all must
serve its own headers, which is a deliberate step rather than a default. The baseline is not
configurable, for the same reason a default is only useful when it is the same everywhere.
