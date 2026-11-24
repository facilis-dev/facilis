---
title: Frontmatter reference
description: The exact schema the content parser accepts, with examples.
order: 1
---

The frontmatter block is a YAML subset parsed by `src/lib/frontmatter.ts`. It opens and
closes with a `---` line; each entry is a `key: value` line.

## Keys

### title

A string. Used for the page heading, the sidebar label and the `<title>` tag. When
absent, the file name is title-cased instead (`content-pipeline.md` → "Content
Pipeline").

### description

A string. Rendered as the lead paragraph under the page title and used as the meta
description. Optional.

### order

An integer. Sorts pages within their section; pages without an order come last, sorted
by title. Negative values are allowed.

## Quoting

Values may be plain, single-quoted or double-quoted. Inside a quoted value, a backslash
escapes the next character, so the quote character itself can be written as an escaped
sequence.

```yaml
---
title: "Release notes: v1.0"
description: 'What changed, and why.'
order: 2
---
```

## Failure behaviour

The parser is fail-soft on purpose:

- No opening `---` line: the whole file is body text.
- Unterminated block: the whole file is body text.
- Non-integer `order`: the key is ignored.
- Unknown keys: ignored, so content can carry extra metadata.

A page never fails to render because of its frontmatter.
