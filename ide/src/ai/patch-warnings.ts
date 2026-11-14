// Review-time warnings for client files (D-047).
//
// A patch that lands Node-only globals or server-only modules in src/ or components/ still
// compiles, then breaks the browser preview ("process is not defined"). The review card warns
// before Apply but never blocks: the user can accept anyway. Messages are not built here; the
// UI translates rule + symbol through t().

import type { FilePatch } from "@facilis.dev/ai";

export type PatchWarningRule =
  | "node-global"
  | "server-import"
  | "raw-color"
  | "palette-class"
  | "arbitrary-value"
  | "missing-page";

export interface PatchWarning {
  path: string;
  rule: PatchWarningRule;
  symbol: string;
}

/** Client roots; server/, db/, locales/, lib/ and the root config are out of scope. */
const CLIENT_ROOTS = ["src/", "components/"];

const NODE_GLOBAL = /\b(process|Buffer|__dirname|__filename)\b/g;
const REQUIRE_CALL = /\brequire\s*\(/g;
const IMPORT_FROM = /\b(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/g;
const BARE_IMPORT = /\bimport\s*["']([^"']+)["']/g;
const REQUIRE_SPECIFIER = /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;

/** Design rules (D-185): the role tokens are the only colour and spacing vocabulary. */
const HEX_COLOR = /#[0-9a-fA-F]{3,8}\b/g;
const PALETTE_CLASS =
  /\b(?:bg|text|border|ring|fill|stroke|from|via|to|outline|divide|decoration|shadow)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)(?:-\d{2,3})?\b/g;
const ARBITRARY_VALUE = /\b[a-z][a-z0-9-]*-\[[^\]\n]+\]/g;
/** Variant selectors that happen to contain brackets, not literal values. */
const ARBITRARY_VARIANTS = ["min-[", "max-[", "data-[", "aria-[", "supports-[", "has-", "group-"];
const PAGE_ROOT = "src/pages/";
/** The catch-all is a bare page by design (D-178), so it is not held to <Page>. */
const PAGE_EXCEPTION = "not-found.tsx";

const SERVER_MODULES = new Set(["fs", "path", "os", "crypto", "child_process", "drizzle-orm"]);
const SERVER_PREFIXES = ["@facilis.dev/db", "@facilis.dev/auth", "@facilis.dev/nitro"];

const STRING_QUOTES = new Set(['"', "'", "`"]);

interface ScanEvent {
  index: number;
  rule: PatchWarningRule;
  symbol: string;
}

/**
 * Remove comments while keeping strings, so prose ("process is server-only") is never a
 * warning and a URL like "https://..." does not swallow the rest of its line. Block comments
 * become whitespace so the tokens on either side stay separate.
 */
function stripComments(source: string): string {
  let output = "";
  let index = 0;
  let quote: string | null = null;

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (quote !== null) {
      output += char;
      if (char === "\\") {
        // Copy the escaped character too, so \" does not close the string.
        if (next !== undefined) {
          output += next;
          index += 2;
          continue;
        }
      }
      if (char === quote) quote = null;
      index += 1;
      continue;
    }

    if (char === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") index += 1;
      continue;
    }

    if (char === "/" && next === "*") {
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
        if (source[index] === "\n") output += "\n";
        index += 1;
      }
      index += 2;
      output += " ";
      continue;
    }

    if (STRING_QUOTES.has(char)) quote = char;
    output += char;
    index += 1;
  }

  return output;
}

function isServerSpecifier(specifier: string): boolean {
  if (specifier.startsWith("node:")) return true;
  if (SERVER_MODULES.has(specifier)) return true;
  return SERVER_PREFIXES.some((prefix) => specifier.startsWith(prefix));
}

/** Every warning candidate in one file, ordered by where it first appears. */
function collect(content: string): ScanEvent[] {
  const events: ScanEvent[] = [];

  for (const match of content.matchAll(NODE_GLOBAL)) {
    if (match[1] !== undefined) {
      events.push({ index: match.index ?? 0, rule: "node-global", symbol: match[1] });
    }
  }

  for (const match of content.matchAll(REQUIRE_CALL)) {
    events.push({ index: match.index ?? 0, rule: "node-global", symbol: "require" });
  }

  for (const pattern of [IMPORT_FROM, BARE_IMPORT, REQUIRE_SPECIFIER]) {
    for (const match of content.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier !== undefined && isServerSpecifier(specifier)) {
        events.push({ index: match.index ?? 0, rule: "server-import", symbol: specifier });
      }
    }
  }

  return events.toSorted((left, right) => left.index - right.index);
}

/** Design warnings for a TSX file: colour, spacing and the page shell (D-185). */
function collectDesign(content: string): ScanEvent[] {
  const events: ScanEvent[] = [];
  const colours = [...content.matchAll(HEX_COLOR)];

  for (const match of colours) {
    events.push({ index: match.index ?? 0, rule: "raw-color", symbol: match[0] });
  }

  for (const match of content.matchAll(PALETTE_CLASS)) {
    events.push({ index: match.index ?? 0, rule: "palette-class", symbol: match[0] });
  }

  for (const match of content.matchAll(ARBITRARY_VALUE)) {
    const symbol = match[0];
    if (ARBITRARY_VARIANTS.some((prefix) => symbol.startsWith(prefix))) continue;
    // text-[#0b0d10] is one problem, not two: the colour already names it.
    const start = match.index ?? 0;
    const end = start + symbol.length;
    if (colours.some((colour) => (colour.index ?? 0) >= start && (colour.index ?? 0) < end)) {
      continue;
    }
    events.push({ index: start, rule: "arbitrary-value", symbol });
  }

  return events;
}

function isClientPath(path: string): boolean {
  const normalized = path.startsWith("./") ? path.slice(2) : path;
  return CLIENT_ROOTS.some((root) => normalized.startsWith(root));
}

function warningKey(warning: PatchWarning): string {
  return warning.path + "\u0000" + warning.rule + "\u0000" + warning.symbol;
}

/** Review-time warnings for client files; never blocking. */
export function scanPatchWarnings(patches: readonly FilePatch[]): PatchWarning[] {
  const warnings: PatchWarning[] = [];
  const seen = new Set<string>();

  for (const patch of patches) {
    if (patch.action === "delete" || typeof patch.content !== "string") continue;
    if (!isClientPath(patch.path)) continue;

    const source = stripComments(patch.content);
    const events = collect(source);
    if (patch.path.endsWith(".tsx")) {
      events.push(...collectDesign(source));
      // A new page that invents its own shell drifts from the one anatomy the prompt names.
      const isPage =
        patch.path.startsWith(PAGE_ROOT) &&
        !patch.path.endsWith(PAGE_EXCEPTION) &&
        !source.includes("<Page");
      if (isPage) {
        events.push({
          index: 0,
          rule: "missing-page",
          symbol: patch.path.slice(PAGE_ROOT.length).replace(/\.tsx$/, ""),
        });
      }
    }

    for (const event of events.toSorted((left, right) => left.index - right.index)) {
      const warning: PatchWarning = { path: patch.path, rule: event.rule, symbol: event.symbol };
      const key = warningKey(warning);
      if (seen.has(key)) continue;
      seen.add(key);
      warnings.push(warning);
    }
  }

  return warnings;
}
