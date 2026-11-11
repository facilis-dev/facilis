# Facilis — website brief

**Status:** v3 — two pillars + the browser-as-sandbox · **Site:** https://facilis.dev
**Contract:** the product contract is `docs/SPEC.md`; this brief is *around* it, like `docs/DECISIONS.md`.
If the site claims something the spec can't back, the spec wins — rewrite the copy.

---

## 1. What the site has to do right now

Pre-MVP (Phase 1 headless-verified; browser/WebContainer items open). The site is **not** a
product page yet — it is a thesis with a waitlist. Three jobs, in order:

1. **Legible in 10 seconds.** A stranger should say back: *"It's the framework where security is
   the fast path, the whole environment is a link you open, and the AI can't reach your machine."*
2. **Credible to a technical buyer.** Spec, decision log, and the parts that don't work yet.
3. **Capture early users.** A waitlist, not a funnel.

Out of scope until Phase 6: pricing, logos, "trusted by", testimonials, marketing automation.

Failure mode: looking like every other 2026 AI-app-builder page (gradient, "10x your team", fake
dashboard). That aesthetic is a negative signal to exactly the audience we want.

---

## 2. The two pillars

The company has two things to sell. Every page must serve one of them — if a section serves
neither, delete it.

| | **1 · Security without friction** | **2 · Speed without setup** |
|---|---|---|
| **Who it convinces** | CTO, tech lead, security reviewer, agency principal | The developer doing the work |
| **Their fear** | "Someone — or something — shipped an endpoint with no auth." | "Another two days before I can run anything." |
| **The promise** | Control lives in the framework, not in review | Day one is a link |
| **The mechanism** | `defineAuthorizedHandler`, generated RLS, roles-as-code, 18-rule AI validator | Static SPA + WebContainer, one process / one port, PGlite, 80% pre-written |
| **The proof** | An unauthorized route doesn't compile | Clone → running, authenticated app in under 3 min |
| **The CTA** | Read the five layers → `/security` | Watch the stopwatch → `/demo` |

### The insight that holds both pillars together

Most security controls work by **removing speed** — gates, queues, checklists. Facilis makes the
secure path the **shortest** path, so the control has no marginal cost:

> `defineAuthorizedHandler` is the shortest way to write a route — and the only way. The permission
> is a required argument. `dbTables` is a required argument. The policy is generated from the
> schema. Following the rule is cheaper than ignoring it.

And the same architecture answers the second pillar: because there is **nothing installed**,
there is nothing to configure wrong — and because the rules are in the **compiler**, there is
nothing to remember. One decision, two outcomes.

### The third audience: your AI

The security pillar had one subject: your developers. It has two now — you are about to hand
write access to a model, and every question you would ask a new hire you now have to ask of an
agent. Facilis answers both the same way: the agent writes files, not commands; the files are
validated before they exist; and the runtime it writes into is a tab, not a machine. The long
version is "the browser is the sandbox" in §4.6.

### The trust layer (kept, but not a pillar)

Skeptics check the exit before they believe the pitch: it's still a git repo, MIT packages,
standard Postgres, deploy anywhere. "No platform lock-in" is the reassurance under both pillars,
not a headline of its own.

### Never claim

"no-code", "production ready", "unbypassable", "zero config", "AI builds your whole app". Say
**framework**, not platform. Say **no platform lock-in**, not "no lock-in".

**One test for every sentence:** does it remove a tax, or does it add a control? If it adds a
control, show how it costs the developer nothing. If it removes a tax, name the number.

---

## 3. Information architecture

One page does the work; the rest is depth. The homepage alternates pillar → proof → pillar → proof.

| Route | Purpose |
|---|---|
| `/` | Hero → two taxes → pillar 1 (security) → five layers → **the browser is the sandbox** → pillar 2 (speed) → the 20% → escape → status → CTA |
| `/try` | The real Studio in the visitor's tab — the single most important page (§6) |
| `/security` | **Pillar page 1:** five layers, threat model, the AI-sandbox argument (`#sandbox`), what it does *not* protect |
| `/speed` | **Pillar page 2:** zero install, one process, the 3-minute stopwatch |
| `/demo` | 3-minute narrated video + 30s silent loop |
| `/docs` | Quickstart, concepts, guides, reference (MDX in repo) |
| `/spec` | A rendering of `docs/SPEC.md`, section-anchored |
| `/decisions` | The ADR log, public — including reversed decisions |
| `/status` | Phase table with honest state |
| `/notes` | Build log / blog (§8) |
| `/manifesto` | The "why" — short prose, no feature grid |
| `/faq` | The questions everyone asks (§4.11) |

Nav: **Security · Speed · Docs · Spec** + one CTA (**Try the Studio**). The two pillar links are
the nav — there is no "Product" dropdown to hide them in.

---

## 4. Draft copy

`shipped` = true today; `planned` = Phase 1–6. Never blur the two in one sentence.

### 4.1 Hero

**H1: The fast way is the safe way.**

> Facilis is a browser-based framework where the secure path is also the shortest one. A route
> can't exist without a permission, a table can't exist without a policy — and the whole dev
> environment opens from a link. Nothing to install. Nothing to remember.

`[Try the Studio — nothing to install]`  `[Read the spec]`

Micro-line: *MIT · runs in your tab · your code never leaves it*

| Alternative H1 | Serves | Use |
|---|---|---|
| **Security that doesn't slow your developers down.** | Pillar 1, explicit | Buyer-facing (LinkedIn, agency pitch) — safest A/B |
| **Control, without the tax.** | Pillar 1, compressed | Section H2; also a good `/security` H1 |
| **Day one is a link.** | Pillar 2 | `/speed` H1, not the homepage |
| **Write only the 20% that's yours.** | Positioning | `/manifesto`, or the hero once the demo carries it |
| **Guardrails, not gates.** | Both | Best paired with the five-layer graphic |
| **Insecure code won't compile.** | Pillar 1, hardest | HN title. Too narrow for the homepage |
| **Your AI is already in the sandbox.** | Pillar 1, the AI | The `#sandbox` headline — and the strongest HN title we have |

Keep "Guardrails, not gates" as the **tagline**, not the H1 — it is a compression of the thesis,
not an explanation of it.

### 4.2 The problem — two taxes

**H2: Every internal app pays two taxes.**

**H3: The security tax.**
> Auth, roles, tenancy, validation, migrations. Do them properly and the first two weeks of every
> project are the same two weeks. Do them later and you pay interest for a year. Most teams do
> both, and review the result by eye.

**H3: The setup tax.**
> Node, Docker, Postgres, env files, CORS, an onboarding wiki that went stale. A new developer's
> first day is a scavenger hunt on a laptop that can't install half of it.

**H2: Low-code removed both taxes by removing the code. Facilis removes the taxes.**

> The 80% is pre-written and enforced. The environment is a URL. You keep the code and the
> control.

### 4.3 Pillar 1 — Security without friction

**Kicker: Security** · **H2: Control, without the tax.**

> You want to control what your developers do without getting in their way. Every control you
> add today does one or the other: a review gate stops someone, an approval queue delays them, a
> checklist gets skipped at 18:00 on a Friday.
>
> Facilis moves the control into the API. A route is written with `defineAuthorizedHandler` — the
> shortest way to write one and the only supported way. The permission is a required argument.
> The tables it touches are a required argument. Row-level security is generated from the schema
> instead of being remembered from a readme.

**H3: The rules outlive the people who wrote them.**
> When the developer who knew the auth pattern leaves, nothing leaves with them. The compiler
> still knows.

Proof bullets:

- `defineAuthorizedHandler` requires `permission` and `dbTables`: a route missing either fails
  the type check, not the review. **[shipped — Phase 1]**
- A scoped table without a policy fails the migration.
- Roles and permissions are code: diffable, reviewable, committed.
- AI output passes 18 rules before it touches disk — so an agent can be given write access
  without being given the ability to create an open endpoint.
- Review moves from *"is this safe?"* to *"is this right?"*

CTA: **See the five layers →** `/security`

### 4.4 Security proof — the five layers

**H2: Five locks, one route.**
> A rule that depends on everyone remembering isn't a rule. Each layer is a different mechanism,
> so a mistake in one is caught by the next — and none of them is a step in your workflow.

1. **Auth middleware** — who the user is.
2. **Route RBAC** — `defineAuthorizedHandler({ permission })`; 403 before the body is parsed.
3. **Row-level security** — which rows are visible, enforced by Postgres, not by a `WHERE`.
4. **App scoping** — the developer forgot a `WHERE`; the policy wrapper didn't.
5. **Zod validation** — malformed and injected input die at the edge.

**The interaction to build here:** let the visitor *remove* a layer and watch what breaks. Delete
`permission` → compile error. Delete the policy → the generated migration says so. One widget
explains the pillar better than the rest of the page.

**Honesty block, right below it:** *This removes whole classes of mistakes — missing auth,
unscoped rows, unvalidated input. It does not stop a developer with repo access from writing a
raw SQL query. No framework does.*

**Proof asset — available today:** the acceptance app's `scripts/verify-headless.sh` asserts
anonymous 401, cross-user DELETE 404, RLS isolation (a second user sees nothing) and `x-db-tables`
reaching OpenAPI. Put the link next to the claim: *"don't take our word for it, run the script"*
beats any diagram we can draw — and it is the only security proof a skeptic can check in 60
seconds.

### 4.5 Pillar 2 — Speed without setup

**Kicker: Speed** · **H2: Day one is a link.**

> There is no install step. The IDE is a static page; the dev server, the API and the database run
> inside the tab. No Node version to match, no Docker to start, no Postgres to provision, no env
> file to copy from a colleague.
>
> Clone a repo, describe what you want, watch it reload. One process, one port — `vite dev` serves
> the client and the API, so there is no second server and no CORS config.

Proof bullets:

- **Setup time: 0 minutes.** The first load downloads the runtime once; after that it's cached.
  *(Honest cost: that first load is real. Say so.)*
- **Works on the laptop IT gave you.** No admin rights, nothing to approve, nothing to install.
- **Fresh database in seconds.** PGlite is a button, not a script.
- **Clone → running, authenticated todo app: under three minutes.** We publish the stopwatch —
  when we hit it the number goes here, and when we miss it, it still goes here.
- **The boring 80% is pre-written:** routes, auth, RLS, migrations, blocks.

CTA: **Watch the three minutes →** `/demo`

**Do not oversell this as "no local setup ever":** the repo still runs with `pnpm dev` on a
normal machine. That's the escape hatch, and it's a feature.

### 4.6 One architecture, both outcomes

**H2: It isn't two features. It's one decision.**

> Move the environment and the rules out of the machine: the environment into the browser, the
> rules into the compiler. Because nothing is installed, there is nothing to configure wrong —
> and that is also why nothing leaves your tab. Because the rules are compiled, there is nothing
> to remember — and that is also why review gets faster instead of slower.

Then the trust strip: *MIT · standard Postgres in production · deploy anywhere · delete the
Studio and the app still runs.*

**H3: The browser is the sandbox.**

> Every browser vendor has spent two decades and a standing bounty program hardening the one
> sandbox that every page already runs in. Everyone building an AI coding agent is now building
> a second one — a container, a microVM, a cloud box with a timeout — because their agent has a
> shell, a filesystem, your credentials and your network.
>
> Facilis's agent has none of those. It emits file patches. The patches are validated against 16
> rules before they touch disk [planned — Phase 4], then written into a virtual filesystem that
> exists only inside the page. No shell to reach, no host to escape to, no ambient credentials to
> find, no local network to scan. The blast radius isn't a container — it's a tab.

**H2: We didn't harden a sandbox. We removed the need for one.**

| | Agent on your machine | Agent in a cloud sandbox | Facilis |
|---|---|---|---|
| What it can touch | your shell, your keys, every repo you own | whatever the box was given | the files it was asked to write |
| Blast radius | your laptop | a container you hope is configured right | one tab |
| Credentials | ambient | your token, on their infrastructure | one PAT, encrypted, scoped per host, never sent to the model |
| Setup | install a CLI, wire the keys | account, quota, VM boot | a URL |
| Who maintains the sandbox | you | them | the browser vendor — and you maintain nothing |

**The honest footnote:** this is not the claim that a browser is a stronger boundary than a
hardened microVM for an agent that needs a shell. It's the smaller claim that our agent never
needed one — and that is the difference between securing a lot of power and not handing it out.
What remains is the network: the page can only reach the hosts it is allowed to reach, which is
why the CSP is part of the product and not the deploy notes.

### 4.7 The 20%

**H2: What you don't write.**

| Framework writes (most shipped in Phase 1) | You write |
|---|---|
| Routes with permission checks and OpenAPI metadata | The screen that matters |
| RLS policies generated from your Drizzle schema | The domain model |
| `role_permissions` seed, migration, drift guard | The business rule only your team knows |
| Auth flows, tables, forms as blocks | The weird export finance asked for |
| i18n keys and `locales/en.json` | The words |
| Migration preview, risk-classified, checked against the API | The decision to ship it |

### 4.8 Escape

**H2: It's a framework. Not a place you move into.**

> No platform. No proprietary runtime. No export button, because there is nothing to export. Your
> app is a git repo: Vite, Nitro, Drizzle, Postgres. Deploy it anywhere; the pipeline runs the
> migration and the Studio only previews it.
>
> A framework is still a dependency — you'll keep importing `@facilis/*`. What you won't do is ask
> permission to leave.

### 4.9 Status

**H2: Where it actually is.**

| Phase | State |
|---|---|
| 0 — feasibility spike | headless done; browser items open |
| 1 — core packages | done — verified headlessly against `examples/todo-app` |
| 2–5 — Studio, visualizers, AI, blocks | not started |
| 6 — MVP demo | not started |

> This site has a status page because a framework arguing for structure should be honest about
> its own. Every non-obvious choice is in the [decision log](../docs/DECISIONS.md) — including
> the ones we had to reverse.

### 4.10 Closing

> **Facilis** is Latin for *easy*. It isn't a promise about how the work feels. It's a claim about
> where the work goes: into the framework once, instead of into every project forever.

Footer: MIT · GitHub · Spec · Decisions · Status · *No cookies, no accounts, no analytics vendor.*

### 4.11 FAQ

1. **Is this no-code?** No. It's code with the boring 80% pre-written. Nothing is hidden from you.
2. **Is it *really* secure?** It removes whole classes of mistakes: missing auth, missing scoping,
   unvalidated input. It doesn't stop a developer with repo access from writing raw SQL. Nothing
   does — and any framework claiming otherwise is selling you a checkbox.
3. **Does "no install" mean no local tooling?** The Studio needs nothing. Later, the same repo
   runs with `pnpm dev` if you prefer a local editor.
4. **What if I stop using Facilis?** You keep the repo. You still import the packages — you don't
   lose the app.
5. **Where does my code live?** In your git host and in your browser tab. Nowhere else.
6. **Do I need an API key?** Yes — any provider. There's no Facilis inference bill.
7. **Is it production ready?** No. Phase 6 is the MVP. That's what the status page is for.
8. **Why "Facilis"?** Latin, *easy* — same root as *facile*. See `/manifesto`.

---

## 5. Copy rules

1. **Every section serves a pillar, or it goes.**
2. **A control must show its zero cost.** Security copy that doesn't name what the developer no
   longer does is the reason developers distrust security copy.
3. **A tax must name its number.** "Fast" → three minutes. "No install" → zero minutes, one page
   load.
4. **No adjective without a mechanism.** "Secure" → name the layer. "Fast" → name the step removed.
5. **Banned:** revolutionize, 10x, seamless, unleash, supercharge, game-changer, magic.
6. **Tense is a claim.** `planned` badge, or rewrite.
7. **Name the limit next to the benefit.** Vivari's memory ceiling (~50 routes), Nitro v3 beta,
   the PGlite RLS caveat, the first-load cost. Trust is built in the parentheses.
8. **Numbers over adjectives, code over screenshots.** The audience reads code.
9. Second person, short sentences, no exclamation marks. One page, one job, one CTA.
10. **Sandbox claims are relative.** Name the boundary — host, filesystem, credentials, network —
    and never say "unbreakable". The precise sentence is the one a security reviewer believes.

---

## 6. Signature idea: `/try` is the real product

Facilis has no backend, so the site can host the actual Studio. Both pillars are proven by the
same click: the environment opens instantly (speed) and the first generated route already has its
permission and its policy (security).

Sequence: `/try` = **a redirect to `ide.facilis.dev`** while the Studio is allowlisted, then the
public entry point when the browser Phase 0 items close. It is a top-level navigation, not an
iframe: COOP/COEP are not inherited by frames and `facilis.dev` has no WebContainer. There is no
waitlist at launch ("in attesa" only).

Other interactive slots worth the design time:

- **Break the route** (§4.4) — the five-layer playground. The security pillar's proof.
- **The stopwatch** — the 3-minute demo with a real timer, not a jump cut. The speed pillar's proof.
- **Two file trees** — "the old way" (14 files, auth bolted on) vs Facilis (3). Shows both taxes.
- **404:** *"404 — the route exists. You don't have permission."* A joke that proves the thesis.

---

## 7. Build

**Static export of a Facilis app created in the Studio (D-091), on Cloudflare Pages.** Every
route is prerendered to HTML at build time from the app's own React tree and hydrated in the
browser; no server runs in production. Astro + Starlight was the earlier proposal (W-2) and is
superseded for the site: the catalog is copy-in component source, so a second rendering stack would
duplicate it, and dogfooding is the point. `/docs` can still adopt Starlight later if its MDX
tooling earns the second stack.

- **Headers for `/try`:** `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp` (WebContainer requirement, spec §13 risk 7; publish
  the recipes — our users hit the same wall).
- **Perf budget:** static HTML, LCP under 1.2s, no render-blocking webfont, under 50 KB JS on `/`.
  A speed pillar argued on a slow page is self-defeating.
- **Analytics:** none at launch. The footer says so. Adding Plausible or self-hosted Umami later
  is a decision, not a default.
- **OG images** generated at build (Satori), one per page.
- **Dogfooding:** the marketing site *is* a Facilis app (D-091) — created in the Studio, exported,
  prerendered, deployed statically. The build journal is published, so the claim is checkable.
- **Content:** MDX in-repo, reviewed in PRs. No CMS.

---

## 8. What to write (content that earns the launch)

One post per phase — build artifacts that happen to be marketing. Mark each with the pillar it
serves; the two pillar essays are the canonical links from `/security` and `/speed`.

| # | Title | Pillar | Phase | Why it works |
|---|---|---|---|---|
| 1 | Guardrails, not gates | 1 | 1 | The thesis essay: why the control should be the API |
| 2 | The route that couldn't exist | 1 | 1 | `defineAuthorizedHandler` as a type-level gate, compiled |
| 3 | Postgres ORs your policies | 1 | 1 | D-008, a real RLS bug we fixed. Best HN bait we have |
| 4 | Zero install | 2 | 2 | What a browser-resident dev server actually buys you |
| 5 | One process, one port | 2 | 2 | Nitro as a Vite plugin, explained |
| 6 | Sixteen rules before the AI touches disk | 1 | 4 | The validator, with the rejection list |
| 7 | We forked an IDE instead of writing one | 2 | 1 | Honest trade-off; documents D-018 |
| 8 | 3:00, measured | 2 | 6 | The launch post: stopwatch result |
| 9 | What Facilis doesn't do | both | 6 | Anti-feature list; counter-intuitively the most trusted post |
| 10 | We didn't build a sandbox, we removed the need for one | 1 | 4 | The AI-security essay: the argument this category is missing |

Cadence: one every two weeks through Phases 1–6 — a `/notes` entry, an X thread, a line on `/status`.

---

## 9. Name, domain, SEO

**Decided: `facilis.dev` is canonical** (see D-020). The `.dev` TLD is the right signal for
this audience and the domain is short enough to say out loud.

The problem it doesn't solve: three existing "Facilis" products (facilis.com media storage,
facilis.ai agentic manufacturing, Facilisgroup). "Facilis" alone is not searchable.

- Every `<title>` and OG card: **"Facilis — descriptor"**, e.g. *"Facilis — security at the
  speed of code"*. Never ship a title that is just "Facilis".
- **Canonicalisation:** `www` redirects (301) to apex; docs at `facilis.dev/docs` (one
  domain to rank) until they outgrow it.
- **Own coined terms, not the brand:** `defineAuthorizedHandler`, "the five layers", "the 20%", "zero
  install". These rank; "Facilis" competes with a storage vendor.
- **Claim the handles now:** GitHub org (`facilis-dev` if `facilis` is taken), npm scope `@facilis`
  (open question O-006 depends on it), X/Bluesky, `hello@facilis.dev`, LinkedIn.
- **Comparison pages** (`/vs/retool`, `/vs/lovable`, `/vs/nextjs`) only *after* launch, and only factual
  and fair — they convert and rank, but read as desperate before you have users.
- Trademark: a quick opinion on "Facilis" in the software class before printing swag.

---

## 10. Sequencing

| When | Ship | Success looks like |
|---|---|---|
| **Now (2–3 days)** | One-pager on `facilis.dev`: hero, two taxes, pillar 1, five layers, pillar 2, status, waitlist | A dev asks "when can I try it?" |
| **+2 weeks** | `/security`, `/speed`, `/spec`, `/decisions`, `/status`, notes #1–3, 30s loop | First feedback on the thesis, not the fonts |
| **Phases 3–4** | 3-minute demo, `/docs` skeleton, live generated demo app | `/try` allowlist opens; watch-through over 60% |
| **Phase 6** | Show HN + public `/try` + notes #8 and #9 | Repos cloned in the Studio by someone who isn't us |

Channels by fit: Hacker News (one shot — Phase 6, not before), r/webdev + r/ExperiencedDevs +
r/Postgres, X (dev-tool crowd), LinkedIn (agencies, internal-tools buyers, Italy). **Skip Product
Hunt** — wrong audience for an infrastructure framework.

**North-star metric pre-launch:** repos cloned in the Studio by someone who isn't us.

---

## 11. Asset checklist

- [ ] Wordmark (works at 16 px), favicon, monochrome variant
- [ ] **"Two taxes" figure** — before/after, one per pillar
- [ ] The five-layer diagram as animatable SVG — the security pillar's signature
- [ ] **"Blast radius" figure** — three columns at equal width: your laptop / a cloud box / one tab
- [ ] **"Day one is a link" animation** — URL to a running editor, no install step
- [ ] 6 screenshots at 2x, real data, no lorem
- [ ] 30-second silent loop (terminal → files → graph → preview)
- [ ] 3-minute narrated demo: scripted, real typing, real timer
- [ ] OG template (Satori) + per-page images
- [ ] Terminal recording for the escape section

**Visual direction:** engineering blueprint, not AI-startup. Paper white and near-black, one
accent, hairline rules, mono for anything machine-made, diagrams over screenshots. The Latin name
suggests calm precision — lean on that, not on gradients.

---

## 12. Decisions

| # | Decision | State |
|---|---|---|
| W-1 | Domain | ✅ `facilis.dev` — canonical, `www` 301s to apex (D-020) |
| W-9 | Message architecture | ✅ two pillars: **security without friction**, **speed without setup**; no-lock-in is the trust layer |
| W-10 | Which pillar leads the homepage | proposed: security leads (bigger budget holder), speed closes (bigger daily pain). A/B against speed-led |
| W-2 | Site stack | ✅ static export of a Studio-created Facilis app (D-091); Astro/Starlight only for `/docs` if it earns it |
| W-3 | EN only, or EN + IT at launch | ✅ EN only; IT later if we target the local community |
| W-4 | Waitlist tool | ✅ none at launch — "in attesa" until the Studio is public |
| W-5 | Publish `/spec` and `/decisions` verbatim? | proposed: yes — it's the credibility play |
| W-6 | `/try` gating | waitlist → allowlist → public |
| W-11 | AI-security message | ✅ the browser is the sandbox — extends pillar 1; no third pillar |
| W-12 | Product name on the site | ✅ **IDE** everywhere; `ide.facilis.dev` is the URL |
