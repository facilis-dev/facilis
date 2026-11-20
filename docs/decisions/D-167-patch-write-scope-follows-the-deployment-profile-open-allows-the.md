# D-167 — Patch write scope follows the deployment profile: `open` allows the project minus the machine surfaces, `managed` keeps the six roots
**Status:** accepted (2026-11-11)

**Context.** Rule 11 `file-path-allowed` only allowed the six project roots plus
`facilis.config.ts` (D-084), so an AI patch could not add a Wrangler config, a `.github`
pipeline, root Vite/Nitro config or `index.html`; the IDE's own writers already had
`allowedRootFiles`, but AI patches never pass it by design. The deployment profile (D-063) is
the right axis: `managed` cannot review each patch, while `open` is the user's own project and
the user still reviews and applies every patch.

**Decision.**

- `validatePatch` gains `writePolicy: "open" | "managed"`, defaulting to `"managed"`
  (fail-closed for external/Node callers); rule 11 keeps its id and severity.
- `managed` is unchanged: the six roots plus `facilis.config.ts`, plus the IDE writer's explicit
  `allowedRootFiles` (AI patches never get it).
- `open` allows any project-relative path except a `node_modules`/`.git`/`.facilis`/`dist`/
  `.turbo`/`coverage` segment, the install surface (`package.json`, `package-lock.json`,
  `npm-shrinkwrap.json`, `pnpm-lock.yaml`, `yarn.lock`, `.npmrc`) and `AGENTS.md`.
- The IDE maps `aiWritePolicy` from its build profile (`ide/src/deploy/current.ts`) and passes
  it to apply/proposal/Apply validation and the PTC validate tool; `buildSystemPrompt` states the
  effective rule in a "## Writable paths" section. Node tooling keeps `managed`.

**Why.** `package.json`/lockfiles/`.npmrc` are the install surface (dependency injection;
AI-SKILLS §4 rule 5, O-009); `node_modules` is code that never went through an install;
`.git`/`.facilis`/`dist`/`.turbo`/`coverage` is VCS/IDE/build state the Explorer does not
review and the PTC read policy already hides; `AGENTS.md` persists instructions into later
sessions (D-084). A CI workflow can read repository secrets, which is why `managed` stays strict.

**Consequences.** Managed AI stays strict and never accepts a CI workflow, which is the point of
the split; `open` builds can create CI, Wrangler and root config. No rule id or count changes.
§5.5/§9.3 of the spec and MANAGED-DEPLOYMENT §1 follow.
