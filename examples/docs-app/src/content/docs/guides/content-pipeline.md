---
title: Content pipeline
description: Frontmatter, Markdown and MDX rendering, and the prerender constraint.
order: 2
---

The pipeline is an example-local convention: plain files in, React elements out, with
two small pure-JS libraries and no build-time content plugin.

## Frontmatter

Each file opens with a YAML-subset block delimited by `---` lines. The schema is fixed:

| Key | Type | Meaning |
| --- | --- | --- |
| title | string | Page title and sidebar label |
| description | string | Lead paragraph and meta description |
| order | integer | Reading order within the section |

Unknown keys are ignored, and a malformed block degrades to "no frontmatter" instead of
breaking the site. The full reference is [here](/docs/reference/frontmatter).

## Markdown rendering

`.md` files render with [marked](https://marked.js.org) — pure JS, zero dependencies.
Headings get slug ids so the table of contents can anchor them. Rendering is a pure
function of the source text, which is what keeps server HTML and client hydration
identical.

## MDX rendering

`.mdx` files compile with `@mdx-js/mdx` **at render time** (`evaluateSync`), cached
per source text. Components come from the layout's component map — this guide's sibling
page uses the built-in `Callout`:

```mdx
<Callout type="info">MDX content can use the layout's components.</Callout>
```

Content does not import modules: the example-local pipeline has no import resolver.

## Why render time, not build time

The framework's prerender pass (D-202) builds its SSR bundle with `configFile: false`:
project Vite plugins do not run there. A build-time plugin such as `@mdx-js/rollup`
would compile content for the client build but not for the prerender build. Raw content
imports plus render-time evaluation work identically in both — and in plain `vite dev`.
