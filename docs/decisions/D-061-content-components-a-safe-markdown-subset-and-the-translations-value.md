# D-061 — Content components: a safe Markdown subset and the translations value shape
**Status:** accepted (2026-11-01)

Owner asked for a rich text editor ("markdown is fine") and a component to manage the
multi-language value of a text. Both ship in `@facilis.dev/ui` as content components:
`MarkdownEditor` + `Markdown` (renderer) and `TranslationsInput`.

**Decision.** The editor is Markdown source, not WYSIWYG: a toolbar transforms the real
textarea selection, Write/Preview tabs render the value, and `Markdown` is exported so pages
render saved content with the same code. Markdown is a **fixed, safe subset**: headings,
paragraphs, bold/italic/inline code, bullet/ordered lists, blockquote, fenced code, hr, line
breaks and links; the renderer builds React elements (never `dangerouslySetInnerHTML`), raw
HTML stays text, and link targets are limited to `http(s)`, `mailto:`, `#` and relative
URLs, so previewing untrusted content cannot inject markup. No new dependency.

`TranslationsInput` edits `Translations = Readonly<Record<string, string>>`, the same shape
`@facilis.dev/i18n-db` stores (D-057) but declared in the kit instead of importing the server
package. Locales come from the project config (`locales`, tab order); `availableLocales`
feeds the add-language action; the default locale is marked and cannot be removed; tabs
carry a filled/empty dot so missing translations are visible. It is a client input only —
no catalogue, no persistence.

**Consequences:** a generated project with a Markdown field or a translated field stays
copyable and dependency-free; the renderer's subset is the contract (extending it means
extending the parser + tests, not adding an HTML sanitiser); the translations value plugs
into `translatedText`/`resolveTranslation` unchanged.
