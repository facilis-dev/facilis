---
title: Getting started
description: Install, run and build the docs site, then add your first page.
order: 2
---

The project is a plain Vite app: npm is the package manager, `vite dev` is the whole
runtime, and there is no server, database or `facilis.config.ts`.

## Run the site

```bash
npm install
npm run dev
```

The dev server binds port 3000. In the Facilis IDE the Run button does the install and
starts the same command inside the WebContainer.

## Add a page

Create a Markdown file under `src/content/docs/` with a frontmatter block:

```markdown
---
title: My page
description: One line about the page.
order: 3
---

## First heading

Write Markdown here. The page appears in the sidebar immediately.
```

The file `src/content/docs/my-page.md` is served at `/docs/my-page` — no React edit
needed. Nested directories work the same way: `guides/advanced.md` becomes
`/docs/guides/advanced`.

## Build for production

```bash
npm run build
npm run preview
```

The build prerenders the routes declared in `vite.config.ts` to static HTML with real
content and metadata; every other route falls back to the SPA shell. See the
[content pipeline guide](/docs/guides/content-pipeline) for how rendering works.
