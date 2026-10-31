# Generated-project frontend — pages, layouts, components

How a Facilis project's client is organised. This is the **generated app's** frontend (the
thing a developer builds in the IDE), not the IDE itself. It builds on the base kit
(`@facilis/ui`, D-047), the date logic (`@facilis/time`, D-048) and the i18n runtime
(`@facilis/core/i18n`, plus optional `@facilis/i18n-db/client`, D-049).

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
├── layouts/              page shells; compose @facilis/ui templates with the router
│   └── app-layout.tsx    header/nav/theme/locale/session + <Outlet/>
├── components/           app-specific pieces (theme-toggle, locale-switch, future widgets)
└── lib/                  non-React logic shared by pages/layouts
    ├── api.ts            fetch wrapper + error codes
    ├── session.tsx       session provider/hooks + guards
    ├── theme.ts          data-theme persistence + hook
    ├── i18n.tsx          catalogue boot + locale state + hook
    └── dates.ts          project-level date formatting on top of @facilis/time
```

Rules:

- **Pages** own their data fetching and their `Page` header; no layout chrome, no raw
  `<main>`/`<header>`. Every string goes through `t()`.
- **Layouts** own navigation and session chrome. They are project code and are copied per
  project (a sidebar is app-specific); only the neutral shells (`Page`, `AuthShell`,
  `EmptyState`, `Spinner`) live in `@facilis/ui`.
- **Components** start in `src/components`; a component is promoted to `@facilis/ui` only
  when it is generic and themeable through the role variables.
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

## 5. Theme — `lib/theme.ts`

The kit is variable-driven (D-047); the app only decides which complete set applies.

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
  in CSS, not component edits.

## 6. i18n — `lib/i18n.tsx`

- Catalogues are the project's `locales/<locale>.json` files (flat keys, O-001); the same
  keys exist in every shipped locale. `errors.<code>`, `auth.*`, `todos.*`, `app.*`,
  `theme.*`, `locale.*`, `common.*`.
- `initI18n()` registers every catalogue, resolves the starting locale
  (stored → `navigator.languages` → default locale) and calls `setDefaultLocale` before the
  first render. `document.documentElement.lang` follows.
- **User language is managed**: `useLocale()` exposes the current locale and a setter; the
  header renders a `LocaleSwitch`; the choice is persisted (`facilis.locale`). `t()` from
  `@facilis/core/i18n` is what pages use — no second translation system.
- **Optional database overlay** (D-049): if the project mounts `GET /api/i18n`, `initI18n`
  may call `hydrateCatalogs({ locales, base, defaultLocale })` from
  `@facilis/i18n-db/client` inside a `try/catch` (a missing overlay must not break boot).
  The reference app uses files only and documents the seam.
- Translated **content** (D-049) is a server concern: the API resolves
  `resolveTranslation(row.title, userLocale)`; the client just renders the string.

## 7. Dates — `lib/dates.ts`

API values are ISO instants; the app formats them in the user's zone with `@facilis/time`.

```ts
export function localTimeZone(): string;                     // Intl resolved zone
export function formatDueDate(iso: string | null, options?: { locale?: string; timeZone?: string }): string | null;
export function dueDateFromInput(dateOnly: string, timeZone?: string): string; // date input -> ISO start of day
export function isOverdue(iso: string | null, options?: { today?: string; timeZone?: string }): boolean;
```

- Never format with `new Date().toLocaleString()` directly; that re-introduces the implicit
  time zone D-048 removed.
- Date-only inputs are `<input type="date">` values converted with `startOfDay`.

## 8. Page states

Every page that loads data renders three explicit states, using kit templates:

1. loading → `<Spinner label={t("common.loading")} />` (or skeleton once the kit has one);
2. error → `<Alert tone="error">` + retry button;
3. empty → `<EmptyState title description action />`; otherwise content.

Mutations toast the outcome (`toast.success` / `toast.error(t(errorMessageKey(error)))`);
they never replace the page with an error blob.

## 9. Reference app

`examples/todo-app` — same server/Nitro/PGlite/auth as the Phase 1 acceptance app, new client:

| Route | Page | Demonstrates |
|---|---|---|
| `/login`, `/register` | LoginPage/RegisterPage | `AuthShell`, `Field`+`Input`, API error codes, session refresh |
| `/todos` | TodosPage | `Page`, create form with date input, `Table`, checkbox toggle, delete, `Badge` for overdue, loading/empty/error, toasts |
| `*` | NotFoundPage | `EmptyState` |

Run: `pnpm --filter @facilis/example-todo-app dev` (Vite + Nitro on one origin).
Gates: `typecheck`, `lint`, `test` (pure lib helpers), `build`.

## 10. Done criteria

- `pnpm --filter @facilis/example-todo-app typecheck | lint | test | build` green; files ≤300
  lines; every user-facing string via `t()` with en+it entries.
- No colour literals in the app (variables only); no direct `fetch` outside `lib/api.ts`;
  no date formatting outside `lib/dates.ts`.
- The same structure is what the IDE project template adopts later (out of scope here:
  `ide/src/facilis/**` stays untouched).
