// Monaco language ids: the path → language mapping, the status-bar picker's
// list, and the human labels. Split out of controller.ts, which the file-length
// ratchet only lets shrink (docs/DECISIONS.md, D-019).

export function languageFor(path: string): string {
  // JS files use the `typescript` language too (the TS worker handles JS via
  // allowJs). This runs ONE language service instead of a second full ~310 MB
  // `javascript` ts.worker fed the same dependency .d.ts payload. See
  // configureLanguageService.
  if (/\.(tsx?|jsx?|mjs|cjs)$/.test(path)) return "typescript";
  if (path.endsWith(".css")) return "css";
  if (path.endsWith(".scss")) return "scss";
  if (path.endsWith(".less")) return "less";
  // .gjs/.gts (Ember) join .vue/.svelte here rather than in the `typescript` line
  // above: they embed a `<template>` block the TS worker parses as a syntax error, so
  // routing them to a Monarch-only language buys highlighting without red squiggles
  // over the markup. `.gjs` is the Ember template's `entry`, so it opens immediately.
  if (/\.(html?|vue|svelte|g[jt]s)$/.test(path)) return "html";
  if (/\.json[5c]?$/.test(path)) return "json";
  if (path.endsWith(".md")) return "markdown";
  // Python: Monarch highlights on the main thread, and — unlike every language
  // below it — a real language service, from jedi and black running on a
  // long-lived Pyodide. Registered lazily, on the first Python model: see
  // ensurePythonLanguage(). Everything after this line is Monarch only.
  if (/\.pyi?$/.test(path)) return "python";
  if (/\.ya?ml$/.test(path)) return "yaml";
  if (/\.(sh|bash|zsh|ksh)$/.test(path)) return "shell";
  if (path.endsWith(".sql")) return "sql";
  if (/\.(xml|xsd|xsl|plist)$/.test(path)) return "xml";
  if (/(^|\/)Dockerfile[^/]*$|\.dockerfile$/.test(path)) return "dockerfile";
  if (path.endsWith(".go")) return "go";
  if (path.endsWith(".rs")) return "rust";
  if (path.endsWith(".java")) return "java";
  if (path.endsWith(".php")) return "php";
  if (path.endsWith(".rb")) return "ruby";
  if (/\.(ini|toml|cfg|conf|properties)$/.test(path)) return "ini";
  return "plaintext";
}

/** The language modes the "Select Language Mode" status-bar picker offers, in
 * display order. Every id is a grammar Monaco already bundles, so listing one
 * costs nothing beyond this entry — but the list is deliberately limited to what
 * `languageFor` can auto-detect, so picking a mode and re-opening the file behave
 * consistently. Anything unrecognised falls back to Plain Text.
 *
 * There is intentionally NO `javascript` entry: `languageFor` maps .js/.jsx/.mjs
 * to `typescript` so the TS worker serves both (see the comment above), and
 * selecting a real `javascript` mode would have Monaco spin up a SECOND full
 * ~310 MB ts.worker for it. .js files therefore report "TypeScript". */
export const LANGUAGE_MODES: { id: string; label: string }[] = [
  { id: "typescript", label: "TypeScript" },
  { id: "css", label: "CSS" },
  { id: "scss", label: "SCSS" },
  { id: "less", label: "Less" },
  { id: "html", label: "HTML" },
  { id: "json", label: "JSON" },
  { id: "markdown", label: "Markdown" },
  { id: "python", label: "Python" },
  { id: "yaml", label: "YAML" },
  { id: "shell", label: "Shell Script" },
  { id: "sql", label: "SQL" },
  { id: "xml", label: "XML" },
  { id: "dockerfile", label: "Dockerfile" },
  { id: "go", label: "Go" },
  { id: "rust", label: "Rust" },
  { id: "java", label: "Java" },
  { id: "php", label: "PHP" },
  { id: "ruby", label: "Ruby" },
  { id: "ini", label: "Ini" },
  { id: "plaintext", label: "Plain Text" },
];

/** Human label for a monaco language id (status-bar readout). */
export function languageLabel(id: string | null): string {
  if (!id) return "Plain Text";
  return LANGUAGE_MODES.find((l) => l.id === id)?.label ?? id;
}
