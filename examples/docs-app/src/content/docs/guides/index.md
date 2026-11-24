---
title: Guides
description: How the content pipeline and the navigation are built.
order: 1
---

These guides explain the two halves of the template: the content pipeline that turns
files into pages, and the navigation surfaces derived from the same content tree.

## In this section

- [Content pipeline](/docs/guides/content-pipeline) — frontmatter, Markdown and MDX
  rendering, and why the pipeline runs at render time.
- [Navigation](/docs/guides/navigation) — the sidebar tree, prev/next links and the
  per-page table of contents.

## A section is a directory

Every subdirectory of `src/content/docs/` is a section. An `index.md` (or
`index.mdx`) inside it becomes the section's leading page and supplies its sidebar
label; without one, the directory name is title-cased instead.
