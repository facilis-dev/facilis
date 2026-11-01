# Managed deployment

**Status:** accepted and partially implemented (2026-11-01): deployment config, build
artifacts, runtime wiring (registry/.npmrc/import guards), the admission gate, the L0 removal
of the remote-import implementation, preview isolation defaults and the AI provider policy
landed (verified by a managed-vs-open `vite build`), and the update checker's local
comparison/indicator landed. Still pending: the in-browser CSP/mirror spike and the upgrade
recipe engine.
Decisions: D-063 (profiles and trust boundary), D-064 (one build-time config).
Related: [SPEC.md](./SPEC.md) §8, [APP-UPDATES.md](./APP-UPDATES.md), D-030, D-032, D-045,
D-051, O-003, O-006.

Facilis is open source and browser-resident. The base product must stay usable by anyone:
any package from any registry, any project the IDE can read. An organisation that deploys
Facilis for its employees has different requirements - which packages may be installed, which
registry may be reached, which projects may run - and cannot accept a server in the loop.
This document defines a *deployment profile* that satisfies those requirements with the same
codebase, no fork and no backend.

## 1. Profiles

Two profiles, selected at build time:

| | `open` (default) | `managed` |
|---|---|---|
| Registry | public npm, anything reachable | one configured registry (mirror) |
| Package allowlist | none | `packages.allow` compiled in + enforced by the mirror |
| Project imports (folder / git host / `#share=`) | available | compiled out |
| Project publish (git write-back) | available; token per publish, never stored | opt-in: `projects.exports.git` plus the host in `network.connect` (D-078) |
| Real git over HTTPS (clone / fetch / pull / push) | yes, through the same-origin proxy (D-079) | opt-in: `projects.gitProxy` (+ `exports.git` for push-only); a cross-origin proxy must be in `network.connect` |
| Project admission | none | `facilis.app.json` required (§8) |
| Preview | same-origin by default | separate preview origin, sandbox without `allow-same-origin` |
| Installable as a PWA | yes (manifest + icons) | yes, on the deployment origin (D-076) |
| AI provider | presets plus a custom base URL | allowlisted providers or an internal gateway; default `off` ([AI-SKILLS.md](./AI-SKILLS.md)) |
| Skills | any installed skill | only allowlisted skills; default none |
| Shell on the VM | available | configurable (`shell` / `run-only`) |
| `window.__vv` (diag + bridge) | dev only (fix regardless) | absent from the production bundle |
| Update indicator | compares the project with the running build | compares with the approved baseline |
| CSP / headers | generated baseline CSP in `headers.conf` (D-072) | deployment policy (§4-§5) |

`open` is the default: a build with no deployment config behaves exactly like today's IDE.
`managed` is not a different product; it is the same sources built with a config. The
default build is not policy-free either: it ships a baseline CSP (§5), enough to block remote
code, plugins and foreign framing while leaving its network open by design (D-072).

## 2. Trust boundary

Three enforcement levels are in scope. A fourth (server-side approval) is deliberately out.

| Level | Enforces | Reachable from page JS? |
|---|---|---|
| **L0 build** | what code exists in the bundle: imports removed, no runtime policy switch, preview origin fixed, `__vv` absent | no |
| **L1 runtime** | checks in the IDE: admission gate, dependency allowlist before install, AI patch validator | yes - guardrail |
| **L2 network** | CSP `script-src`/`connect-src`, the configured registry, the host's egress policy | no |

### What a managed deployment guarantees

- the sanctioned origin only loads code that shipped in its build (`script-src 'self'`);
- it only reaches configured hosts (`connect-src`): the registry mirror and the preview origin;
- `npm install` inside the VM can only fetch packages the mirror serves - the mirror is the
  only reachable package host, and the project's `.npmrc` points at it;
- a project without a valid `facilis.app.json` does not run (configurable, §8);
- the generated app's own code runs on a different origin from the IDE, so it cannot read the
  IDE's `localStorage` (AI keys, git identity), its OPFS or the kernel bridge;
- when AI is enabled, its requests can only reach the providers the deployment allows (or its
  gateway), and the key can only be read by the IDE origin.

### What it does not guarantee

- that a determined insider cannot execute hand-written JavaScript in the browser console of
  the sanctioned origin (bounded by `script-src` and `connect-src`, but not eliminated);
- that the OSS IDE cannot be run elsewhere - the control is over *this* deployment's origin
  and network, not over the employee's machine;
- that an *approved* package is harmless: allowlist, cooldown, audit and SBOM are a process,
  not a runtime check;
- that a self-hosted operator's modified artifact still enforces anything;
- that a model provider handles the code it receives as agreed - that is a contract with the
  provider and a deployment choice, not a property of the build (AI-SKILLS.md §2).

These limits are why D-063 says "policy plus enforced network", never "impossible".

## 3. Configuration

One file, build time, JSON - data, not code: the build never executes the deployment config.
The field reference is `DeploymentInput` in `ide/src/deploy/types.ts`:

```json
{
  "profile": "managed",
  "company": { "name": "Acme", "domain": "facilis.acme.example" },

  "packages": {
    "registry": "https://npm.acme.example",
    "allow": [
      "@facilis/*", "react", "react-dom", "react-router-dom", "zod",
      "drizzle-orm", "drizzle-kit", "nitro", "vite", "@vitejs/plugin-react",
      "@electric-sql/pglite"
    ],
    "installScripts": "deny",
    "lockfile": "required"
  },

  "projects": {
    "admission": "facilis-only",
    "imports": { "folder": false, "git": false, "share": false },
    "exports": { "git": false },
    "preview": { "origin": "https://preview.facilis.acme.example" },
    "shell": "shell"
  },

  "ai": { "mode": "off", "providers": [], "gateway": null },

  "skills": { "allow": [] },

  "network": { "connect": ["https://npm.acme.example"] },
  "updates": { "channel": "approved", "baseline": "2026.11" }
}
```

Real git (D-079) travels through the stateless proxy, so it is configured separately from the
REST paths: `"projects": { "exports": { "git": true }, "gitProxy": "same-origin" }` uses the Pages
Function on the deployment's own origin, while `"gitProxy": "https://git-proxy.acme.example"` names
one that must also appear in `network.connect`. With no `gitProxy` the remote half is compiled out
of the bundle and only the REST importer/publish (if enabled) can reach a host.

### Where the config comes from

The build reads the path from `FACILIS_DEPLOY_CONFIG`, a **build-time** environment variable
(the running app never reads it):

```
FACILIS_DEPLOY_CONFIG=./deploy/acme.json pnpm --filter @facilis/ide build:app
```

- unset: the build is `open`, exactly today's artifact;
- set: the file must exist and validate against the same schema. A missing file, a schema
  error or a missing `profile` **fails the build** - a typo must never produce a
  permissive artifact;
- the file is **JSON**, validated against the shape shown above: no code executes during a
  deployment build (an IT-managed config is data, not a build script);
- the resolved config is hashed (SHA-256) into `environment.json`, so the artifact and
  the build log identify exactly which policy produced it.

The config is a **build input**, not a runtime file: it is compiled into the bundle (§2, L0).
A served JSON file that changes policy at runtime is explicitly not supported - see §4.

Rules:

- `profile` defaults to `open`; a `managed` build **fails** when `packages.registry`
  or `projects.preview.origin` are missing.
- the config is compiled into the bundle: there is no runtime toggle and no config fetch.
- it must not carry secrets: the mirror is anonymous read-only (§6). Registry credentials
  belong to the mirror's own upstream configuration, never to the browser.
- one config is one origin. Two companies are two configs and two builds (§10).
- AI and skills default to off/none in a managed build; enabling them is a policy decision
  with its own contract ([AI-SKILLS.md](./AI-SKILLS.md)).

## 4. Build outputs

| Artifact | Consumer | Content |
|---|---|---|
| `dist/` | the host | SPA with the profile compiled in (imports tree-shaken, no `__vv`, preview origin, no public-registry preconnect) |
| `environment.json` | operator, update checker | version, profile, company, registry host, artifact hashes, update baseline |
| `headers.conf` | host / CDN | COOP, COEP, CSP, `Service-Worker-Allowed`, caching (§5) |
| `npmrc.template` | generated project | `registry=`, `audit=`, script policy, no fallback |
| `mirror-allowlist.json` | the mirror | the packages/versions the config allows |

The allowlist is generated from the same `packages.allow` the bundle uses: the IDE's check
and the mirror cannot drift.

`environment.json` carries the config hash and a SHA-256 per emitted artifact. Signing and
verifying it is the operator's CI step, not a build feature - a page cannot meaningfully
verify its own integrity. It exists for provenance and audit, and for the hosted case (§10).

### Compiled authority versus served data

Two things are easy to confuse, and the distinction is what keeps L0 honest:

- **authority** - profile, imports, allowlist, preview origin, update baseline: compiled into
  the bundle. The app cannot read them from a file, so editing a served file changes nothing.
- **data** - `environment.json` (version, config hash, company label) and the changelog:
  served same-origin, read at runtime, and harmless if tampered with - they describe the
  deployment, they do not decide what it enforces.

The update checker reads the version and baseline compiled into the build;
`environment.json` mirrors them for the operator's audit and for the hosted pipeline (§10).
Changing policy means rebuilding; changing data does not.

## 5. Hosting

A managed deployment is a static site on a dedicated origin. The origin is part of the
security model: per-origin browser storage is what isolates one company's projects, OPFS and
AI keys from another's.

Required headers (the first two are already mandatory for the WebContainer, so header
configuration is not new operational work):

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Service-Worker-Allowed: /
Content-Security-Policy: <draft below>
```

Draft CSP, to be pinned by the spike (§12) - every directive below has a reason:

```
default-src 'self';
script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval';
worker-src 'self' blob:;
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
font-src 'self';
connect-src 'self' https://npm.acme.example https://preview.facilis.acme.example;
frame-src 'self' https://preview.facilis.acme.example;
base-uri 'none';
object-src 'none';
```

Notes:

- `wasm-unsafe-eval` is required by the WebContainer and by rolldown's wasm binding.
- `unsafe-eval` is required because the kernel is an evaluator: the VM compiles and runs
  the project's code with `new Function` (`vendor/vivari/packages/runtime/module.js`
  documents the requirement). Measured 2026-11-01 in Chromium: without it the Studio boots,
  a project is created, and the VM never evaluates, so the preview never paints. There is
  no way to give the wasm/VM code a narrower permission from a header, so this is a real
  relaxation. It does not change what the CSP is for here: the policy is about *where code
  and data may come from* (registry, preview origin, LLM host), not about integrity of code
  that is already in the tab. The boundary remains the build-time policy plus the network
  and registry (§2, D-063, D-071).
- `worker-src blob:` covers workers created from blobs (Monaco, devtools frontend).
- `style-src 'unsafe-inline'` is the likely cost of Monaco/Tailwind; verify in the spike
  and tighten if possible.
- `connect-src` must include the preview origin because the preview shim's HMR/webSocket
  tunnel and pop-out relay are cross-origin in the isolated modes.
- COOP/COEP cannot be set with `<meta>`; the host must send them, which is why
  `headers.conf` ships with the build.
- HMR stays same-origin through the Service Worker; external sockets are opt-in
  (`BootOptions.netRelay`) and out of scope here.

### Open profile baseline

The default build is not policy-free either (D-072). Its `headers.conf` carries the policy
below: the same code rules as managed, with the network deliberately open.

```
default-src 'self';
script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval' 'sha256-<inline script>';
worker-src 'self' blob:;
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
font-src 'self' data:;
media-src 'self' blob:;
connect-src 'self' https: wss: ws: blob: data:;
frame-src 'self';
base-uri 'none';
object-src 'none';
```

What it buys: no remote script (a project cannot import code from a CDN), no plugins
(`object-src`), no base-URL rewriting (`base-uri`), no framing of another origin. What it does
not buy: exfiltration over the network is still possible in this profile by design - that is
what `managed` exists for.

The `sha256-` token is emitted by the build itself: the pre-paint theme script is inline in
`index.html`, and without its hash the policy would drop it silently (a theme flash that
looks like a rendering bug). `vite.deployment.ts` hashes every inline script it finds, so a
future one is covered for free.

Host recipes (nginx, Caddy, Cloudflare Pages) ship with the build; the exact snippets are
implementation detail, the header set is the contract.

## 6. Registry mirror

The mirror is the L2 enforcement point for "which libraries". Requirements:

- **anonymous read-only**: no auth from the browser. The kernel's egress policy strips
  `authorization` and npm's custom headers for hosts named `registry.*`
  (`vendor/vivari/packages/runtime/egress-header-policy.js`), so an authenticated mirror
  must not be presented as `registry.*`. Use `npm.<company>` and keep it read-only.
- `Access-Control-Allow-Origin: *` on metadata and tarballs, and a preflight answer that
  allows npm's headers - a non-`registry.*` hostname keeps its custom headers and therefore
  gets a real preflight.
- allowlist from `mirror-allowlist.json`, optionally a cooldown on newly published versions,
  integrity hashes preserved from upstream, and an audit log of what was served.
- upstream: public npm (proxy) or a curated internal registry. In air-gapped deployments the
  upstream is whatever the company already mirrors.

The generated project's install is deterministic against the mirror: the registry is the only
package host that can answer. The exact lockfile mechanics interact with D-032 (the
`@facilis/*` packages are `file:` tarballs, which a committed lockfile cannot pin
portably), so that detail is owned by the implementation spike in §12 and the open questions
in §11.

## 7. Air-gapped

The configuration is the same; what changes is the network. The deployment must work with no
route to the public internet:

- `connect-src` names only the internal mirror and the internal preview origin;
- nothing in the bundle points at `registry.npmjs.org` (today `warmRegistryConnection()`
  in `ide/src/vv/run-phase.ts` hardcodes it - it becomes config-driven);
- the npm CLI shipped in `ide/public/vendor/npm-pack.bin` is local; its registry comes from
  the generated `.npmrc`;
- optional and strongest: ship the Facilis template's lockfile plus a `node_modules`
  snapshot in the kernel's dep-cache (`vendor/depcache/index.json`), so a new project never
  consults a registry at all. The kernel already supports both mechanisms; the Facilis
  template ships neither today.

## 8. Admission gate (Facilis-only projects)

A managed deployment defaults to `admission: "facilis-only"`:

- `facilis.app.json` is written by the template loader at creation (schema in
  [APP-UPDATES.md](./APP-UPDATES.md) §1) and records template and environment version;
- open/Run/install verify it: a missing or mismatched marker refuses to run the project (and
  in `managed`, refuses to create the workspace from an import);
- the import paths are compiled out, so there is no UI to bring one in;
- `admission: "any"` keeps the import paths for adopters who want the editor use case
  (D-051), at their own risk.

## 9. Enforcement points (implementation map)

| What | Today | Change | Level |
|---|---|---|---|
| Import from a git host/folder/`#share=` | `ide/src/vv/git-import.ts`, `ide/src/vv/github-import.ts`, `ide/src/vv/project-import.ts` | tree-shaken when `imports` are false | L0 |
| Publish to a git host (write-back) | `ide/src/vv/git-push.ts` + `github-push.ts` / `gitlab-push.ts` / `gitea-push.ts`, planned by `ide/src/vv/project-publish.ts` | stubbed when `projects.exports.git` is false (the managed default); enabling it requires the API host in `network.connect` | L0 + L2 |
| Real git (clone / fetch / pull / push) | `ide/src/vv/git-remote.ts`, `git-remote-session.ts`; proxy `ide/git-proxy/handler.mjs` + `ide/functions/git-proxy/` | stubbed when `projects.gitProxy` is null; a cross-origin proxy origin joins `connect-src` through `network.connect` | L0 + L2 |
| `window.__vv` | installed unconditionally (`vendor/vivari/packages/core/src/bridge.ts`) | gate on `import.meta.env.DEV` (a vendor bump, D-030) | L0 |
| Preview origin / sandbox | same-origin default, `allow-same-origin` (`ide/src/components/ide/PreviewPanel.tsx`) | `VITE_PREVIEW_ORIGIN` / `VITE_PREVIEW_WILDCARD_DOMAIN`, drop `allow-same-origin` | L0 |
| Public-registry preconnect | `warmRegistryConnection()` hardcodes `https://registry.npmjs.org` (`ide/src/vv/run-phase.ts`) | config-driven, absent when unset | L0 |
| Generated `.npmrc` | fixed: audit/fund/progress/update-notifier off (`ide/src/facilis/project-files.ts`) | generated from `packages` (registry, scripts, no fallback) | L0 |
| Registry fetch | hardcoded public registry through the fetcher worker | `REGISTRY_PROXY` seam (`vendor/vivari/packages/core/src/workers/fetcher-worker.ts`) -> mirror | L2 |
| Admission | none (a registry flag only chooses the run manifest) | `facilis.app.json` check before open/Run | L1 |
| Dependency allowlist | none | `preinstall` check in the template + AI validator rule on `package.json` | L1 |
| AI egress | presets plus a custom base URL (`ide/src/ai/providers.ts`, `ide/src/ai/settings.ts`) | allowlisted providers/gateway only, custom base URL rejected; their hosts join `connect-src` | L2 |
| AI key vs preview | the same-origin preview can read `vv-ai-settings` | preview isolation is a prerequisite for enabling AI | L0 |
| AI patches | structural validator only (`packages/ai/src/index.ts`), warnings for client files only | blocking rules (AI-SKILLS.md §4) before `managed` enables AI | L1 |
| Skills | none | manifest + capabilities + deployment allowlist (AI-SKILLS.md) | L0/L1 |
| CSP / headers | none | `headers.conf` + hosting recipe | L2 |

Vendor-side changes ride a submodule bump (D-030): never edit `vendor/vivari` in place.

## 10. Multi-tenant hosting

"Multi-tenant" here means **N single-tenant deployments**, one build and one origin per
company (O-003: one deployment is single-tenant). The build pipeline produces and signs one
artifact per config; the operator deploys it to that company's origin. There is still no
server at runtime.

This is also the migration path between the two hosting modes: the artifact and the config
are the same, so a company can start hosted (`facilis.acme.example`) and move to
self-hosted - or the other way - without changing the product or the data model (browser
storage is per-origin, so projects are exported and imported, not copied).

## 11. Open questions

- Signing key ownership for hosted-versus-self-hosted builds (who verifies, what the trust
  root is).
- Whether `managed` should forbid *creating* a project when the marker is missing, or only
  refuse to run it.
- Preview origin: dedicated hostname versus wildcard-per-port (`mode C`), and the auth
  impact of moving the app off the IDE origin.
- Lockfile mechanics for the generated project while `@facilis/*` are `file:` tarballs
  (D-032), and whether the mirror serves them once O-006 is resolved.
- Whether a managed deployment may use an internal LLM gateway while forbidding direct
  providers (AI-SKILLS.md §2).
- Whether purely cosmetic fields (company name, logo) may come from a served file without a
  rebuild - harmless, but it adds a second config surface; default: no.

## 12. Spike: strict CSP + custom registry in the WebContainer

The riskiest assumption is that the Studio runs under the CSP in §5 while npm installs from a
custom registry. Acceptance criteria:

1. The IDE boots and a project runs under the draft CSP with **zero** CSP violations in
   Chromium; any expected violation is added to this document with its reason.
2. The dependency install resolves through the mirror; `registry.npmjs.org` is unreachable
   and the failure is a clean, narrated error, not a hang.
3. The preview works in the isolated mode (separate origin, no `allow-same-origin`), and the
   app's own `/api` calls still work.
4. Monaco, xterm, IntelliSense, HMR and PGlite are unaffected.

Deliverable: the exact directive list, the directives that had to be relaxed and why, and the
mirror configuration that made it work.

**Result so far (2026-11-01, Chromium, headless smoke driving the real UI).** A production
build was served by a static host with the generated `headers.conf` and the draft CSP, with
the same build served without a CSP as the control:

| Run | Result |
|---|---|
| draft CSP (`'wasm-unsafe-eval'` only) | shell boots, Home renders, project created - then the VM never evaluates and the preview never paints |
| draft CSP + `'unsafe-eval'` | identical to the control: project created, `npm install` inside the VM completes, the preview paints, `/api` answers |
| no CSP (control) | same passing set |

So criterion 1 holds with one expected relaxation, now part of the generated CSP (§5): the
kernel evaluates the project's code, and no header can scope eval more narrowly than
`script-src`. The remaining differences are identical with and without the CSP (editor
IntelliSense service, chat mock, `/vendor/{locks,depcache}/index.json` 404s), so they come
from driving a static build rather than the dev server, not from the policy.

The baseline open policy (§5) was verified the same way: the open build served with its own
generated `headers.conf` completes the same run - preview paints, `/api` answers, no console
or page errors - with the same seven non-CSP failures as the control. So the baseline changes
no behaviour; it only removes the remote-code and framing vectors.

Still open: the **isolated** preview origin (needs a second origin serving
`__vv-preview-boot.html`), the **custom mirror with CORS and preflight** (criterion 2, needs a
real mirror), and criterion 4 on a managed build (admission and AI off change the same paths).
The work is tracked in §11.

## 13. Non-goals

- no approval server, no build service, no runtime service (L3 is out of scope);
- no runtime policy file: the profile is a build input and is compiled in, so no served file
  can change what the deployment enforces;
- no fork: `managed` is `open` plus a config;
- no secrets in the browser bundle;
- no server-side AI proxy: the AI is the browser's call, the provider or gateway is the
  declared exception (AI-SKILLS.md).
