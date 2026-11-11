# Resource pages — the standard for a list → detail → chart section

Status: draft (2026-11-11). This is the contract both the AI and a human follow to add a section
to a generated Facilis project. The reference implementation and the checker are **not in the
tree yet** (`scripts/dev/fixtures/` is absent), so §8 has no evidence; the checklist and the
anti-patterns are the part in force.

Why a standard: at section scale the model stops failing on syntax and starts failing on
**plumbing** — it invents an envelope, forgets a permission, filters client-side, adds no
route or no i18n key. The 19-rule validator cannot see any of that. A short, exact contract
plus one reference file per surface removes most of the degrees of freedom.

## 1. What a section is

One resource, three surfaces, one wiring checklist:

| surface | page | server | job |
|---|---|---|---|
| list | `src/pages/<resources>.tsx` | `GET /api/<resources>` | paginated table, search, status filter |
| detail | `src/pages/<resource>-detail.tsx` | `GET /api/<resources>/:id` | record + linked rows |
| chart | `src/components/weekly-chart.tsx` | `GET /api/<resources>/:id/stats` | one aggregation, SVG bars |

Everything else (schema, permissions, i18n, router, nav) is §6.

## 2. API contract

### 2.1 List — one envelope, always

```http
GET /api/projects?page=1&pageSize=20&q=acme&status=all&sort=createdAt&order=desc
200 { "rows": [...], "total": 42, "page": 1, "pageSize": 20 }
```

Rules:

- `page` is 1-based (default 1); `pageSize` default 20, max 100.
- `q` is trimmed, max 100 chars, empty means no filter, matched **server-side** with ILIKE on
  the resource name (escape `%`, `_` and `\` before interpolating).
- `status` is an enum (default `all`); `sort`/`order` are allow-lists, never raw column names.
- Order is stable: `(sort, id)`, so paging cannot repeat or skip rows.
- An empty page is `200` with `rows: []` and `total: 0`, never a 404.
- The client never pages or filters a server list in memory.

### 2.2 Detail — record plus linked rows

```http
GET /api/projects/a1b2...
200 { "row": { ... }, "todos": [ ... ], "todosTotal": 12 }
404 { "code": "not_found" }
```

- `params` is validated (`z.uuid()`) and a missing/foreign row is `fail("not_found")`:
  RLS makes "not yours" indistinguishable from "does not exist".
- Linked rows are the latest 20 ordered by `createdAt desc`, plus the true total, so the page
  can say "12 todos" without a second call.

### 2.3 Stats — chart data, server-side

```http
GET /api/projects/a1b2.../stats?weeks=8
200 { "buckets": [ { "weekStart": "2026-09-14", "count": 3 }, ... ] }
```

- `weeks` is clamped (1–26, default 8).
- Exactly `weeks` buckets, oldest → newest, **zeros included**: the server fills the gaps, the
  chart never does date math.
- `weekStart` is an ISO date (Monday) rendered with `formatDateOnly` from `@facilis/time`.

### 2.4 Errors

Codes only, via `fail("not_found" | "invalid_input" | …)` from `@facilis/core`; the client
maps the code to `errors.<code>` through `errorMessageKey` in `src/lib/api.ts`. No prose.

## 3. Server route shape (list)

```ts
import { z } from "zod";
import { and, asc, count, desc, eq, ilike } from "drizzle-orm";
import { defineAuthorizedHandler } from "@facilis/core";
import { projects } from "~/db/schema";

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).optional(),
  status: z.enum(["all", "active", "archived"]).default("all"),
  sort: z.enum(["createdAt", "name"]).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

export default defineAuthorizedHandler(
  {
    permission: ["projects:read"],
    query: listQuery,
    dbTables: ["projects"],
    dbColumns: ["projects.name", "projects.status", "projects.createdAt"],
    description: "List projects visible to the current user (RLS-scoped, paginated).",
  },
  async (_event, { query, db }) => {
    const where = and(
      query.status === "all" ? undefined : eq(projects.status, query.status),
      query.q === undefined || query.q.length === 0
        ? undefined
        : ilike(projects.name, "%" + escapeLike(query.q) + "%"),
    );
    const [totalRow] = await db.select({ value: count() }).from(projects).where(where);
    const rows = await db
      .select({ id: projects.id, name: projects.name, status: projects.status, description: projects.description, createdAt: projects.createdAt, ownerId: projects.ownerId })
      .from(projects)
      .where(where)
      .orderBy(query.order === "asc" ? asc(projects.createdAt) : desc(projects.createdAt), asc(projects.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);
    return { rows, total: Number(totalRow?.value ?? 0), page: query.page, pageSize: query.pageSize };
  },
);
```

`escapeLike` is a three-line local helper (`/\\/g`, `/%/g`, `/_/g` → `\\$&`).
**`total` is always `Number(...)`**: PGlite returns `count(*)` as a bigint/string.

## 4. Client shape

### 4.1 `src/lib/<resource>.ts` — types and path builder, pure

```ts
export interface Project { id: string; name: string; status: "active" | "archived"; description: string | null; createdAt: string; ownerId: string }
export interface ProjectList { rows: readonly Project[]; total: number; page: number; pageSize: number }
export interface ProjectDetail { row: Project; todos: readonly ProjectTodo[]; todosTotal: number }
export interface ProjectStats { buckets: readonly { weekStart: string; count: number }[] }
export function projectListPath(input: { page: number; pageSize: number; q?: string; status?: "all" | "active" | "archived" }): string
```

No React, no fetch in this file; the path builder keeps `URLSearchParams` in one place.

### 4.2 List page

- State machine `loading | error | ready`; fetch through `api<ProjectList>(projectListPath(...))`.
- `TableToolbar` (search input + status `Select`) above `ProjectsTable`; `Pagination` below with
  `pageCount = Math.max(1, Math.ceil(total / pageSize))`.
- Search is debounced 250 ms; changing search or status resets `page` to 1.
- Loading → `Skeleton` rows; error → `Alert` + retry; empty → `EmptyState`.
- List errors render inline (no toast); mutations toast.
- Row title is a `Link` to `/projects/:id`.

### 4.3 Detail page

- `useParams` → `Promise.all([api(detail), api(stats)])`; a `not_found` error renders the
  `EmptyState` with a back action instead of an error blob.
- Layout: `Page` header + `Card` with the chart + related rows table (latest 20) + the total.

### 4.4 Chart component

- No chart dependency (the generated app ships none): one `<svg role="img" aria-label>` with
  rects, `fill="var(--color-primary)"`, axis in a role token, labels through
  `formatDateOnly` — tokens only, no colour literals.
- Empty/zero data still renders the axis and a translated "no data" line.

## 5. Schema and migration

```ts
export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantColumn(),
    ownerId: uuid("owner_id").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull().default("active"),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  () => [tenantIsolationPolicy(), ownerIsolationPolicy()],
).enableRLS();

// child link on the existing table
projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
```

The schema DDL is **generated, never authored**: no human and no AI writes `.sql`. The release
pipeline reads `db/schema.ts` + `facilis.config.ts` at the previous release tag and at the new tag
and generates the artifact from the diff, with no database access (D-158);
`facilis db deploy --release <tag>` applies the pending artifacts through the ledger (D-159). In
dev, boot reconciles the live PGlite schema to the declared one with the same planner on disposable
data; that is the only exception and never a release path.

## 6. Wiring checklist (every section)

- [ ] permission `<resource>:read` in `facilis.config.ts` and in the roles that need it
- [ ] schema table + `tenantIsolationPolicy` + `ownerIsolationPolicy` + `.enableRLS()`; FK on the child
- [ ] routes: list (`query`, `dbTables`, `permission`), detail (`params`, `fail("not_found")`), stats (`weeks` clamp)
- [ ] `src/lib/<resource>.ts` types + path builder
- [ ] list page, detail page, table component, chart component
- [ ] routes in `src/app.tsx`
- [ ] nav link in `src/layouts/app-layout.tsx`
- [ ] `locales/en.json` and `locales/it.json` with the same keys (`t()` everywhere)
- [ ] no colour literals, no `fetch` outside `lib/api.ts`, no server import in `src/`, files ≤ 300 lines

## 7. Reference implementation

The section-standard fixture (`scripts/dev/fixtures/section-standard/project/`) and its checker
are not in the tree yet. When they return, the section becomes the few-shot bundle the chat ships.

## 8. Evidence (probe)

Not collected: the probe needs the fixture above. It should compare the validator, typecheck and
wiring, the baseline prompt against the standard prompt, and the token/speed cost.

## 9. Anti-patterns

- Client-side pagination or filtering over a server list (loads everything; dies at 10k rows).
- Returning a bare array for a list (no `total` → no page count, no "showing 21–40").
- Hand-written migration SQL.
- `total` left as the driver's bigint/string.
- One 600-line page file (split page / table / chart).
- A chart library (recharts & co.) — not in the template dependencies; use SVG.
- Invented components or invented kit props: read [`FRONTEND.md`](./FRONTEND.md) for the template v2 component layer.
