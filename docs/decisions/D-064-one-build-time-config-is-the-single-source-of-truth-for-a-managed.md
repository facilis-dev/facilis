# D-064 — One build-time config is the single source of truth for a managed deployment
**Status:** accepted (2026-11-01)

A managed deployment has several places that must agree: what the IDE allows, what the
registry serves, what the CSP allows, what the generated project's `.npmrc` says, and what the
update checker treats as approved. Configured separately they drift, and drift in the
allowlist is a security bug.

**Decision.** A single `facilis.deploy.json` is compiled into the build and
emits every other artifact: the dependency allowlist, `mirror-allowlist.json` for the
registry, the AI provider and skills allowlists, `npmrc.template`, `headers.conf`
(COOP/COEP + CSP) and an `environment.json` manifest.
Invalid configs fail the build. No secrets in the config: the mirror is anonymous read-only. The
build reads the config path from the **build-time** `FACILIS_DEPLOY_CONFIG` variable (unset means
`open`; set-but-missing or invalid fails the build) and hashes the resolved config into
`environment.json`. The file is JSON under one schema: no code executes during a deployment
build, and the config is a build input, never fetched at runtime - a served file that changes
policy is rejected, because that would make L0 switchable from the browser.
Artifacts and hosting requirements: `docs/MANAGED-DEPLOYMENT.md` §4-§6.

**Consequences:** adding a package to a deployment is a config change plus a rebuild, and the
mirror and the IDE cannot disagree; the CSP is generated, not hand-maintained; a mirror is a
hard requirement of `managed`, not an add-on. One CI pipeline can build every company's
artifact by pointing `FACILIS_DEPLOY_CONFIG` at that company's config.
