# D-023 — Packed Facilis tarballs expose compiled dist
**Status:** accepted (2026-10-27, Phase 0 browser spike)

The generated project's Vite config is loaded with `--configLoader native` (Vite's own config
bundler cannot run in the WebContainer), and a native ESM loader refuses to strip types from
files under `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`). The config imports
`@facilis.dev/nitro/vite`, so that entry must be JavaScript. `pnpm ide:facilis-deps` therefore
builds each package, packs it, and rewrites the packed manifest's `exports` from `./src/*.ts`
to `./dist/*.js`; the workspace source keeps its `src` entry points. `@facilis.dev/nitro` also
derives its Nitro handler file paths from the extension of its own module (`RUNTIME_EXT`),
because a dist build previously registered `dist/routes/*.ts` handlers that do not exist.

**Consequences:** the packaging script builds before packing (a stale dist is a real bug, not
a warning), tarballs ship both trees, and the `.ts` handler assertions in the package tests
stay valid because tests import `src`.
