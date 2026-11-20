# D-063 — A deployment has two build profiles, `open` and `managed`, and no server
**Status:** accepted (2026-11-01)

The base product is open source and browser-resident: it must let anyone install any package
from any registry. An organisation that deploys it for its employees needs the opposite —
which libraries may be installed, which registry is reachable, which projects may run — and
will not accept a backend in the loop. One behaviour cannot satisfy both.

**Decision.** The IDE is built in one of two **deployment profiles**, chosen at build time:
`open` (default: today's behaviour, no restrictions) and `managed` (a company build driven by
a `facilis.deploy.json` config, served on a dedicated origin). `managed` is not a fork and has
no runtime policy switch: the restrictions are compiled into the artifact. Enforcement is
explicitly L0 (build) + L1 (runtime checks) + L2 (network: CSP, registry mirror, host egress).
Server-side approval (L3) is out of scope by decision, which is why the contract states what a
deployment does *not* guarantee. Contract: `docs/MANAGED-DEPLOYMENT.md`.

**Consequences:** the OSS base keeps zero friction; an adopter's build is reproducible from
the same sources; each company is one build on its own origin, which gives per-origin browser
storage isolation for free (O-003: a deployment is single-tenant). The security claim is "the
sanctioned origin loads only build-time code and reaches only configured hosts", never "a
browser cannot run other code". Implementing it requires making the app compatible with a
strict CSP and a custom registry: today it hardcodes the public registry and ships no CSP.
