# Generated-project frontend — pages, layouts, components

How a Facilis project's client is organised. This is the **generated app's** frontend (the
thing a developer builds in the IDE), not the IDE itself. The UI layer is template v2 (D-090):
Tailwind CSS v4 + Base UI, with shadcn-style primitives copied into the project and owned by it.
The v1 `@facilis.dev/ui` kit (D-055) was removed (D-096); projects created before D-090 are not
supported. The stack builds on
the date logic (`@facilis.dev/time`, D-056) and the i18n runtime (`@facilis.dev/core/i18n`, plus the
optional `@facilis.dev/i18n-db/client`, D-057).

Reference implementation: `examples/todo-app/src` (real Nitro/PGlite backend: auth, todos).
It is the acceptance app for this organisation, so the pattern is runnable, not a sketch.

## 1. Directory layout (inside `<project>/src`)

```
src/
├── main.tsx              bootstrap: theme + i18n + router, then render <App />
├── app.tsx               providers + route table (one file, no hidden routing)
├── pages/                one file per route; no layout markup in a page
│   ├── login.tsx
│   ├── register.tsx
│   ├── todos.tsx
│   └── not-found.tsx
├── layouts/              page shells; compose the ui primitives with the router
│   └── app-layout.tsx    header/nav/theme/locale/session + <Outlet/>
├── components/           app-specific pieces (theme-toggle, locale-switch, todo widgets)
│   └── ui/               shadcn-style primitives, copied in once and owned (D-090)
│       ├── button.tsx
│       ├── input.tsx
│       ├── select.tsx
│       ├── dialog.tsx
│       ├── table.tsx
│       └── …
├── lib/                  non-React logic shared by pages/layouts
│   ├── api.ts            fetch wrapper + error codes
│   ├── session.tsx       session provider/hooks + guards
│   ├── theme.ts          data-theme persistence + hook
│   ├── i18n.tsx          catalogue boot + locale state + hook
│   ├── dates.ts          project-level date formatting on top of @facilis.dev/time
│   └── utils.ts          cn() — clsx + tailwind-merge
├── styles.css            Tailwind entry: @import "tailwindcss" + @theme + theme blocks
└── styles/               optional app-specific layout CSS

```

Rules:

- **Pages** own their data fetching and their `Page` header; no layout chrome, no raw
  `<main>`/`<header>`. Every string goes through `t()`.
- **Layouts** own navigation and session chrome. They are project code and are copied per
  project (a sidebar is app-specific); only the neutral shells (`Page`, `AuthShell`,
  `EmptyState`, `Spinner`) live in `src/components/ui`.
- **Components** start in `src/components`; the shadcn-style primitives live in
  `src/components/ui`, are copied in once (template v2, D-090) and belong to the project. There
  is no separate component package to promote to: customise by editing the file, and build
  app-specific pieces beside it.
- **Tailwind utilities are the styling API**, with `cn()` for conditional classes and `cva` for
  variant surfaces (as in `button.tsx`). A component that needs more than that gets a small
  local wrapper or a `styles.css` rule; there is no second utility layer.
- **lib** is framework-free where possible: pure helpers take their inputs (locale, dates,
  storage values) so they are unit-testable without a DOM.
- Named exports only; kebab-case files; React components PascalCase; files ≤ 300 lines.

## 2. Routing

`react-router-dom` v7 in declarative mode. The route table lives in `app.tsx`; no
file-based magic, so the generated code is explicit and the AI can edit one obvious place.

```tsx
<Routes>
  <Route element={<AppLayout />}>
    <Route path="/" element={<Navigate to="/todos" replace />} />
    <Route path="/todos" element={<RequireAuth><TodosPage /></RequireAuth>} />
  </Route>
  <Route path="/login" element={<PublicOnly><LoginPage /></PublicOnly>} />
  <Route path="/register" element={<PublicOnly><RegisterPage /></PublicOnly>} />
  <Route path="*" element={<NotFoundPage />} />
</Routes>
```

**Preview base path.** In the IDE the app is served under `/preview/<port>/`; standalone it
is at `/`. `main.tsx` mounts `<BrowserRouter basename={appBasePath()}>`, and `lib/api.ts`
uses the same prefix for fetches, so links, reloads and API calls work both in the IDE
preview and in a normal deploy:

```ts
// lib/api.ts
export function appBasePath(pathname?: string): string; // "/preview/3000" or ""
```

## 3. Data access — `lib/api.ts`

One fetch wrapper; no data library. API errors are **codes, not prose** (framework contract),
so the client maps them to translated messages.

```ts
export class ApiError extends Error {
  readonly code: string;      // e.g. "unauthorized", "invalid_input", "network_error"
  readonly details?: unknown;
  readonly status: number;
}
export function api<T>(path: string, init?: RequestInit): Promise<T>;
export function errorMessageKey(error: unknown): string; // "errors.<code>"
```

- Sends JSON, keeps the same-origin session cookie, returns `undefined` for 204/empty.
- Non-2xx: parse `{ code, details? }` and throw `ApiError`; network failure → code
  `"network_error"`. Never surfaces prose from the server.
- Pages call `toast.error(t(errorMessageKey(error)))`; `errors.*` keys ship in both
  catalogues (see §6).

## 4. Session and guards — `lib/session.tsx`

```ts
export interface Session {
  authenticated: boolean;
  userId?: string;
  roles?: readonly string[];
  permissions?: readonly string[];
}
export function SessionProvider({ children }: { children: ReactNode }): ReactElement;
export function useSession(): {
  session: Session | null;
  loading: boolean;
  refresh(): Promise<void>;
  logout(): Promise<void>;
};
export function RequireAuth({ children }: { children: ReactNode }): ReactElement;
export function PublicOnly({ children }: { children: ReactNode }): ReactElement;
```

- Loads `GET /api/auth/session` once at boot (with a Spinner while pending).
- `RequireAuth` → `<Navigate to="/login" state={{ from }} />` when anonymous;
  `PublicOnly` → `/todos` when already authenticated. No other auth mechanism: the session
  cookie is the identity (framework contract).
- `logout()` posts `/api/auth/logout`, refreshes the session and lands on `/login`.
- Roles/permissions come from the session; conditional UI uses them (`session.permissions`).

## 5. Theme — `lib/theme.ts` + `src/styles.css`

The theme is variable-driven (D-090, direction A): `src/styles.css` maps the shadcn role
vocabulary (`--background`, `--foreground`, `--card`, `--primary`, `--muted`, `--border`,
`--ring`, …) through `@theme inline` and holds complete `:root`/`[data-theme="light"]` and
`[data-theme="dark"]` sets. The app only decides which set applies; no component names a colour.

```ts
export type Theme = "light" | "dark";
export function initTheme(): void;              // stored → prefers-color-scheme → light
export function setTheme(theme: Theme): void;   // persists + writes data-theme
export function toggleTheme(): void;
export function useTheme(): { theme: Theme; setTheme(t: Theme): void; toggle(): void };
export function resolveTheme(stored: string | null, prefersDark: boolean): Theme; // pure, tested
```

- `localStorage["facilis.theme"]`; `document.documentElement.dataset.theme = theme`.
- No component knows the values; adding a project theme means another `[data-theme] block`
  in `styles.css`, not component edits. `@custom-variant dark (&:is([data-theme="dark"] *))`
  is what makes the `dark:` utilities follow the attribute.
- Rebranding is editing the variables (direction A's greens, radii and densities are already
  there); deeper changes are Tailwind classes or a copied component.
- The visual system behind those variables — token set, type scale, motion recipes, page
  anatomy — is [DESIGN.md](./DESIGN.md) (D-185); `styles.css` is its single point of truth.

## 6. i18n — `lib/i18n.tsx`

- Catalogues are the project's `locales/<locale>.json` files (flat keys, O-001); the same
  keys exist in every shipped locale. `errors.<code>`, `auth.*`, `todos.*`, `app.*`,
  `theme.*`, `locale.*`, `common.*`.
- `initI18n()` registers every catalogue, resolves the starting locale
  (stored → `navigator.languages` → default locale) and calls `setDefaultLocale` before the
  first render. `document.documentElement.lang` follows.
- **User language is managed**: `useLocale()` exposes the current locale and a setter; the
  header renders a `LocaleSwitch`; the choice is persisted (`facilis.locale`). `t()` from
  `@facilis.dev/core/i18n` is what pages use — no second translation system.
- **Optional database overlay** (D-057): if the project mounts `GET /api/i18n`, `initI18n`
  may call `hydrateCatalogs({ locales, base, defaultLocale })` from
  `@facilis.dev/i18n-db/client` inside a `try/catch` (a missing overlay must not break boot).
  The reference app uses files only and documents the seam.
- Translated **content** (D-057) is a server concern: the API resolves
  `resolveTranslation(row.title, userLocale)`; the client just renders the string.

## 7. Dates — `lib/dates.ts`

API values are ISO instants; the app formats them in the user's zone with `@facilis.dev/time`.

```ts
export function localTimeZone(): string;                     // Intl resolved zone
export function formatDueDate(iso: string | null, options?: { locale?: string; timeZone?: string }): string | null;
export function dueDateFromInput(dateOnly: string, timeZone?: string): string; // date input -> ISO start of day
export function isOverdue(iso: string | null, options?: { today?: string; timeZone?: string }): boolean;
```

- Never format with `new Date().toLocaleString()` directly; that re-introduces the implicit
  time zone D-056 removed.
- Date-only inputs are `<input type="date">` values converted with `startOfDay`.

## 8. Page states

Every page that loads data renders three explicit states, using the copied primitives:

1. loading → `<Skeleton>` rows/cards, or `<Spinner label={t("common.loading")} />` for a
   whole surface;
2. error → `<Alert tone="error">` + retry button;
3. empty → `<EmptyState title description action />`; otherwise content.

Tables use the `Table` primitives plus an app-specific toolbar (search + filter controls from
`Input`/`Select`/`Button`); destructive actions ask through `Dialog`; `Field` wires the
label/description/invalid state. Richer patterns (calendar picker, combobox, markdown editor,
translations input) are not in the template: a project adds the primitive when it needs it, which
keeps the starter lean and is exactly the copy-in model the catalog will use.

Mutations toast the outcome (`toast.success` / `toast.error(t(errorMessageKey(error)))`);
they never replace the page with an error blob.

## 9. Reference app

`examples/todo-app` — same server/Nitro/PGlite/auth as the Phase 1 acceptance app, new client:

| Route | Page | Demonstrates |
|---|---|---|
| `/login`, `/register` | LoginPage/RegisterPage | `AuthShell`, `Field`+`Input`, API error codes, session refresh |
| `/todos` | TodosPage | `Page`, create form with a native date input, `Table`, checkbox toggle, delete through `Dialog`, `Badge` for overdue, loading/empty/error, sonner toasts |
| `*` | NotFoundPage | `EmptyState` |

Run: `pnpm --filter @facilis.dev/example-todo-app dev` (Vite + Nitro on one origin).
Gates: `typecheck`, `lint`, `test` (pure lib helpers), `build`.

## 10. Done criteria

- `pnpm --filter @facilis.dev/example-todo-app typecheck | lint | test | build` green; files ≤300
  lines; every user-facing string via `t()` with en+it entries.
- No colour literals in the app (variables only); no direct `fetch` outside `lib/api.ts`;
  no date formatting outside `lib/dates.ts`.
- The UI layer is the generated project's UI layer: template v2 (D-090) is this structure,
  not a parallel one. The v1 kit was removed (D-096).
