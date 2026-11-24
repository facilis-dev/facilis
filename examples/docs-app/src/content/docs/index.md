---
title: Introduction
description: What this template ships and how the documentation is organized.
order: 1
---

Facilis Docs is a static documentation-site template: React 19, Vite and Tailwind v4,
with a Markdown/MDX content pipeline and **no backend**. Every page you are reading is a
file under `src/content/docs/`, rendered at build time and in the browser from the same
React tree.

## What you get

- A sidebar generated from the content tree — directories become sections.
- Prev/next links that follow the reading order set by frontmatter.
- A per-page table of contents built from the page headings.
- Prerendered static HTML for the declared routes, hydrated on the client (D-202).

## How the site is organized

The content root is `src/content/docs/`. Top-level pages sit next to each other;
subdirectories become sections with their own index page:

```text
src/content/docs/
├── index.md              -> /docs
├── getting-started.md    -> /docs/getting-started
├── guides/
│   ├── index.md          -> /docs/guides
│   ├── content-pipeline.md
│   └── navigation.mdx
└── reference/
    └── frontmatter.md
```

## Where to go next

Read [Getting started](/docs/getting-started) to run the site, then the
[guides](/docs/guides) for the content pipeline and navigation details.
