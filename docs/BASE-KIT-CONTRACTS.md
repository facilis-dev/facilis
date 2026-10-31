# Base kit — components and logic for generated projects

Coordination contract for the **base layer a Facilis project can use**, i.e. code that a
generated project (the app a developer builds in the IDE) imports, not code for the IDE
itself. The IDE, its panels, its theme and its i18n are out of scope here.

Product directive (2026-10-31):

- **Components**: one small, opinionated set (table, toaster, inputs, …). Colours, radii and
  the other "small things" are customised through **daisyUI-style CSS variables** in a theme
  block. Anything deeper is "recreate the component": the source ships in the package, so a
  project can copy a component and own it. No prop-sprawl, no per-component theme props.
- **Logic**: the smallest possible modules, each opt-in. A project either imports a module or
  it doesn't; there is nothing to configure.

The contract file only fixes module boundaries and public API so the packages can be built
in parallel. `docs/SPEC.md` wins if it ever conflicts; decisions are recorded in
`docs/DECISIONS.md` (D-047 … D-049).

## 1. Ownership

| Area | Files you own | Owner |
|---|---|---|
| UI kit + gallery | `packages/ui/**`, `examples/ui-gallery/**` | ui-kit |
| Date/time logic | `packages/time/**` | time-logic |
| DB catalogue logic | `packages/i18n-db/**` | i18n-db |
| Contracts, docs, root config, install, git, final gates | everything else (`docs/**`, root `package.json`, `pnpm-lock.yaml`) | Lead |

## 2. Ground rules (repo rules apply, this list is only the reminder)

- Read `AGENTS.md`, this file and the package's entry in `docs/DECISIONS.md` before coding.
- **Never** run `pnpm add` / `pnpm install` / `git` commands: the Lead owns dependencies and
  git. Ask the Lead for a new dependency.
- Do not edit files outside your scope. Ask the Lead instead.
- **Max 300 lines per file** (enforced by `scripts/check-file-length.mjs`); split by
  responsibility, never by adding an exclusion. Named exports only, kebab-case file names,
  components PascalCase in `src/*.tsx`, ESM, TypeScript strict, no `any`, comments explain
  *why*.
- Relative imports inside a package carry `.ts` / `.tsx` (`from "./field.tsx"`), because the
  workspace exports `src` directly.
- Every module ships colocated `*.test.ts` / `*.test.tsx` (Vitest). Tests are deterministic,
  offline and fast.
- Per-package gates while working (from the package directory):
  `pnpm exec tsc -p tsconfig.json --noEmit`, `pnpm exec vitest run`, `pnpm exec oxlint src`,
  `pnpm exec prettier --check src theme.css` (ui only for the CSS file).

## 3. `@facilis/ui` — base components

**Styling contract.** The package is **plain CSS + CSS custom properties**, not Tailwind
utilities. Reason: a generated project must be able to use the kit without installing or
configuring a CSS framework — the current generated template is plain CSS — and the whole
component has to remain copy-pasteable. A project is still free to use Tailwind for its own
layout; the kit only owns the `.fc-*` classes and the theme variables. The palette lives in
exactly one file, `theme.css`; no component may contain a colour literal.

### 3.1 Public surface (flat named exports from `src/index.ts`)

| Export | Props | Notes |
|---|---|---|
| `Button` | native `button` props + `variant?: "primary" \| "secondary" \| "ghost" \| "danger"` (default `primary`), `size?: "sm" \| "md"` (default `md`) | |
| `Input`, `Textarea`, `Select` | native props for their element | `Select` renders native `<select>` with `{children}` as options |
| `Checkbox` | native `input` props | forced `type="checkbox"` |
| `Field` | `label: string`, `hint?: string`, `error?: string`, `children`, `className?` | wires `htmlFor`, `id`, `aria-describedby` and `aria-invalid` into the child control automatically; an explicit prop on the control wins |
| `Table` + `TableHeader`, `TableBody`, `TableFooter`, `TableRow`, `TableHead`, `TableCell`, `TableCaption` | native element props | `Table` renders the horizontal-scroll wrapper + `<table>`; the rest map 1:1 to their HTML element |
| `Badge` | `tone?: "neutral" \| "primary" \| "success" \| "warning" \| "error" \| "info"` (default `neutral`) | |
| `Alert` | `tone?: "info" \| "success" \| "warning" \| "error"` (default `info`), native div props | `role="alert"` for warning/error, `role="status"` otherwise |
| `Toaster` | no props | render once, near the app root |
| `toast` | `toast(message)` (info) + `toast.info/success/warning/error(message)` | fixed 4 s auto-dismiss; no options |

Out of scope for this slice: dialog/modal, tabs, combobox, date picker, file upload, layout
primitives. They come as their own components (or are copied from the source) later.

### 3.2 Theme variables (the customisation surface)

`theme.css` defines `:root` (light, default), `[data-theme="light"]` and
`[data-theme="dark"]` as **complete** variable sets. A project sets
`document.documentElement.dataset.theme = "dark"` (or omits it for light) and overrides only
the variables it wants in its own CSS. Adding a theme or rebranding must never require a
component change.

| Variable | Used for |
|---|---|
| `--color-base-100` / `--color-base-200` / `--color-base-300` | page/panel surfaces, muted rows, borders |
| `--color-base-content` | default text |
| `--color-primary` / `--color-primary-content` | primary action |
| `--color-secondary` / `--color-secondary-content` | secondary action |
| `--color-neutral` / `--color-neutral-content` | neutral chips, muted actions |
| `--color-info` / `--color-success` / `--color-warning` / `--color-error` (+ `-content`) | status roles |
| `--radius-selector` | checkbox, badge |
| `--radius-field` | buttons, inputs, selects |
| `--radius-box` | cards, tables, alerts, toasts |
| `--border-width` | border width used by the field/box components |

### 3.3 Class and file layout

- `theme.css` — variables, `color-scheme`, and the `.fc-*` component rules. No component
  module contains a colour value.
- `src/index.ts` — flat named re-exports, nothing else.
- One file per component (or per small family): `button.tsx`, `input.tsx`,
  `textarea.tsx`, `select.tsx`, `checkbox.tsx`, `field.tsx`, `table.tsx`,
  `badge.tsx`, `alert.tsx`, `toaster.tsx` (+ `toaster-store.ts` for the testable store).
- `src/index.ts` must not pull a component that does not exist yet; add exports as files land.
- Tests render with `react-dom/server` (`renderToStaticMarkup`) — no jsdom dependency — and
  assert roles/aria/classes; the toast store is tested directly with fake timers.

### 3.4 Gallery

`examples/ui-gallery` is the acceptance example: a plain Vite + React app (no Tailwind) that
imports `@facilis/ui/theme.css`, renders every component, and toggles light/dark with a
button. `pnpm --filter @facilis/example-ui-gallery build` must pass.

## 4. `@facilis/time` — date/time logic

Zero dependencies, everything through `Intl`; no Temporal polyfill (not in Node 22/24 and
not guaranteed in the WebContainer browser). Instants are `Date` objects or ISO strings;
a "calendar day" is the `YYYY-MM-DD` string. Functions take the time zone explicitly and
default to the runtime zone only where it is obvious.

| Export | Behaviour |
|---|---|
| `formatDate(value, { locale?, timeZone? }?)` | localized date (`medium` style), in the given zone |
| `formatDateTime(value, …)` | localized date + time |
| `formatTime(value, …)` | localized time |
| `formatDateOnly("YYYY-MM-DD", { locale? })` | localized calendar date; never shifts across zones |
| `isValidDateOnly(value)` | strict `YYYY-MM-DD` check (real calendar dates only) |
| `dateOnlyOf(value, timeZone?)` | the `YYYY-MM-DD` an instant falls on in that zone |
| `today(timeZone?, now?)` | `todayIn` semantics for the given instant |
| `startOfDay(dateOnly, timeZone)` / `endOfDay(dateOnly, timeZone)` | UTC `Date` of local 00:00 / 23:59:59.999; DST-aware |

Invalid values throw `RangeError` (bad date/zone) or `TypeError` (wrong type): callers see
programming errors instead of silently rendered garbage. Tests cover UTC, `Europe/Rome`
(DST both directions), `America/New_York`, `Asia/Kathmandu` (+05:45) and date-line cases.

## 5. `@facilis/i18n-db` — database i18n

The user's clarification (2026-10-31): "testi traducibili a db" means **a text stored in a row
can carry several languages, and the app serves only the user's language** — not (only) the UI
catalogue. The package therefore has two independent, opt-in pieces:

- **A. Translated content fields** — the primary one: a typed `Translations` value + `jsonb`
  column helper, plus locale resolution (`resolveTranslation`, `resolveUserLocale`).
- **B. Catalogue overlay** — optional: UI message keys can be overridden per deployment in the
  database; the JSON catalogues of `@facilis/core/i18n` stay the base and the fallback.

Nothing is enabled by configuration: a project imports the column helper / the loaders / the
client and it works; a project that imports nothing keeps file-only i18n unchanged.

### 5.1 Translated content (shared + server exports)

```ts
export type Translations = Readonly<Record<string, string>>; // { en: "Todo", it: "Da fare" }

export const translationsSchema: z.ZodType<Translations>; // locale tags + non-empty values
export function translatedText(name: string): /* jsonb column $type<Translations>, NOT NULL */;

export function resolveTranslation(
  value: Translations | null | undefined,
  locale: string,
  fallbackLocale?: string, // default "en"
): string;

export function normalizeLocale(tag: string): string | null; // Intl-canonical, null if invalid
export function matchLocale(locale: string | undefined, supported: readonly string[], fallback: string): string;
export function parseAcceptLanguage(header: string | null | undefined): string[]; // q-ordered, no "*"
export function resolveUserLocale(options: {
  userLocale?: string | null;      // saved preference (e.g. a profile column), wins
  acceptLanguage?: string | null;  // request header, second
  supported?: readonly string[];   // application locales; default all
  defaultLocale?: string;          // default "en"
}): string;
```

Semantics:

- **storage**: one `jsonb` column per translatable field in the project schema —
  `title: translatedText("title").notNull()`; drizzle-kit generates the migration, the package
  ships none.
- **serving**: `resolveTranslation` tries exact locale → base language (`it-CH` → `it`) →
  `fallbackLocale` → the first present value → `""`; it tolerates null/malformed values and
  never throws. The API maps rows with it, so only the user's language leaves the server:
  `title: resolveTranslation(post.title, userLocale)`.
- **user language**: `resolveUserLocale` takes the saved preference, then `Accept-Language`,
  then the default, filtered by `supported`. Storage of the preference is the app's (a
  profile column); this package only resolves it. The client can import the same pure helpers
  from `@facilis/i18n-db/client`.
- the raw `Translations` object is still what the DB stores and what admin/edit APIs accept;
  validation is `translationsSchema`.

### 5.2 Catalogue overlay table (server export)

`i18n_messages`: `tenant_id uuid` (default `tenantDefaultSql()`, `tenantColumn()`),
`locale text`, `key text`, `value text`, `updated_at timestamptz default now()`; primary
key `(tenant_id, locale, key)`; `ENABLE ROW LEVEL SECURITY` + `tenantIsolationPolicy()`
(restrictive) **AND** a permissive `i18n_messages_tenant_access` policy
(`app.tenant_id` present). A restrictive-only policy admits no rows at all (D-008), so the
permissive gate is required; it mirrors `@facilis/auth`'s `users_tenant_access`. A project
re-exports the table from its `db/schema.ts` and lets drizzle-kit generate the migration.

### 5.3 Catalogue server API (root export)

| Export | Behaviour |
|---|---|
| `i18nMessages` | the Drizzle table |
| `loadCatalog(db, locale)` | `Promise<Record<string, string>>` for one locale, RLS-scoped |
| `loadCatalogs(db, locales)` | `Promise<Record<string, Record<string, string>>>` |
| `saveCatalog(db, locale, messages)` | upsert every key (seeding/admin) |
| `catalogQuery` | zod `{ locales: string }` default `"en"` |
| `parseCatalogLocales(raw)` | `"en,it"` → deduped `["en","it"]`, blank → `["en"]` |

**No ready-made handler export.** The Nitro AST pass reads only
`export default defineAuthorizedHandler({ ... }, handler)`; a re-export from the package would
be invisible to it and the route would lose `permission`/`dbTables` in the manifest and
OpenAPI (security invariant 2). The project writes the explicit route — eight lines, and the
AST sees the literal:

```ts
// server/routes/api/i18n.get.ts
import { defineAuthorizedHandler } from "@facilis/core";
import { catalogQuery, loadCatalogs, parseCatalogLocales } from "@facilis/i18n-db";

export default defineAuthorizedHandler(
  { permission: [], dbTables: ["i18n_messages"], query: catalogQuery },
  async (_event, { query, db }) => loadCatalogs(db, parseCatalogLocales(query.locales)),
);
```

### 5.4 Catalogue client API (`@facilis/i18n-db/client`)

```ts
hydrateCatalogs({
  locales: ["en", "it"],           // required
  base?: { en: enJson },           // bundled JSON, DB wins per key
  defaultLocale?: "en",            // optional setDefaultLocale after registration
  endpoint?: "/api/i18n",          // default
}): Promise<void>
```

Fetches `?locales=`, merges `{...base[locale], ...remote[locale]}`, registers each locale
through `registerCatalog`, then applies `defaultLocale` if given. Throws on a non-2xx
response, malformed payload or network error so boot can decide (the docs show the
try/catch); the module never logs. This entry point re-exports the pure locale/translation
helpers and must not import drizzle (guarded by a test).

### 5.5 Tests

PGlite integration (in-memory `createDb`): DDL + policies, two-tenant isolation,
`loadCatalog`, `saveCatalog` upsert round-trip; a handler test using the explicit route
shape; client test with a fake `fetch`; pure-unit tests for the translation fallback chain,
locale matching, Accept-Language ordering, `translationsSchema` and the `translatedText`
column definition.

## 6. Done criteria

- Each package: `pnpm --filter <pkg> typecheck`, `test`, `lint`, `build` green; files ≤ 300 lines.
- `examples/ui-gallery`: build + typecheck + lint green.
- Lead: root `pnpm install` (lockfile), `pnpm lint`, `pnpm typecheck`, `pnpm test`,
  `pnpm build`, `docs/SPEC.md` §4/§5 + `docs/DECISIONS.md` D-047…D-049 updated.
- Out of scope (reported, not done here): wiring the packages into the IDE template
  (`ide/src/facilis/**`), the vendor tarball list in `scripts/dev/vendor-facilis-deps.sh`,
  and the starter repo.

Report scope, public API as delivered, tests and anything the Lead must change; do not commit
or touch git.