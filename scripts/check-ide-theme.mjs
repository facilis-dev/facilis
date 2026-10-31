#!/usr/bin/env node
/**
 * Enforces D-044: themes are complete variable sets and components name roles.
 *
 * Fails when a theme block is missing a role, when the registered themes and the CSS
 * blocks disagree, or when a component contains a hex colour / raw palette class
 * (brand marks and dialog scrims excepted). Adding a theme must not require touching
 * components; adding a role must touch every theme.
 *
 * Run from the repo root (wired into `pnpm lint`). Also runnable directly.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const CSS_PATH = join(ROOT, "ide/src/index.css");
const THEMES_PATH = join(ROOT, "ide/src/ui-themes.ts");
const EN_PATH = join(ROOT, "ide/src/i18n/en.ts");

const REQUIRED_ROLES = [
  "--radius",
  "--background",
  "--foreground",
  "--card",
  "--card-foreground",
  "--popover",
  "--popover-foreground",
  "--primary",
  "--primary-foreground",
  "--secondary",
  "--secondary-foreground",
  "--muted",
  "--muted-foreground",
  "--accent",
  "--accent-foreground",
  "--destructive",
  "--border",
  "--input",
  "--ring",
  "--sidebar",
  "--sidebar-foreground",
  "--sidebar-border",
  "--chrome",
  "--chrome-foreground",
  "--editor",
  "--editor-foreground",
  "--panel",
  "--panel-foreground",
  "--overlay",
  "--brand",
  "--brand-foreground",
  "--info",
  "--info-foreground",
  "--success",
  "--success-foreground",
  "--warning",
  "--warning-foreground",
  "--checker",
].sort();

const BRAND_MARK_FILES = new Set(["templateIcons.tsx"]);
const RAW_COLOUR =
  /#[0-9a-fA-F]{3,8}\b|\b(?:bg|text|border|ring|fill|stroke|shadow)-(?:white|black|gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-[0-9]{2,3})?\b/g;

const failures = [];
const fail = (message) => failures.push(message);

/** The body of one [data-theme="…"] block, via balanced braces. */
function themeBlock(css, attribute) {
  const match = new RegExp('\\[data-theme="' + attribute + '"\\]\\s*\\{').exec(css);
  if (!match) return null;
  const open = match.index + match[0].length - 1;
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  return null;
}

const roleNames = (body) => [...body.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]).sort();

/** Strip comments so a hex shown in an explanation is not a violation. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[\r\n])\s*\/\/[^\r\n]*/g, "$1");
}

// ── themes ────────────────────────────────────────────────────────────────────
const css = readFileSync(CSS_PATH, "utf8");
const themesSource = readFileSync(THEMES_PATH, "utf8");
const enSource = readFileSync(EN_PATH, "utf8");

const attributes = [...themesSource.matchAll(/attribute:\s*"([^"]+)"/g)].map((m) => m[1]);
const labelKeys = [...themesSource.matchAll(/labelKey:\s*"([^"]+)"/g)].map((m) => m[1]);
if (attributes.length === 0) fail("ui-themes.ts registers no theme");
if (labelKeys.length !== attributes.length) fail("ui-themes.ts: every theme needs a labelKey");

let referenceRoles = null;
for (const attribute of attributes) {
  const body = themeBlock(css, attribute);
  if (body === null) {
    fail('index.css: missing [data-theme="' + attribute + '"] block');
    continue;
  }
  if (!/color-scheme:\s*(light|dark);/.test(body)) {
    fail('index.css: [data-theme="' + attribute + '"] declares no color-scheme');
  }
  const roles = roleNames(body);
  if (referenceRoles === null) referenceRoles = roles;
  else if (JSON.stringify(roles) !== JSON.stringify(referenceRoles)) {
    const missing = referenceRoles.filter((role) => !roles.includes(role));
    const extra = roles.filter((role) => !referenceRoles.includes(role));
    fail(
      'index.css: [data-theme="' +
        attribute +
        '"] role set differs from the first theme (missing: ' +
        (missing.join(", ") || "none") +
        "; extra: " +
        (extra.join(", ") || "none") +
        ")",
    );
  }
}
if (referenceRoles !== null) {
  for (const role of REQUIRED_ROLES) {
    if (!referenceRoles.includes(role))
      fail("index.css: no theme defines the required role " + role);
  }
}
for (const key of labelKeys) {
  if (!enSource.includes('"' + key + '"'))
    fail('i18n/en.ts: missing theme label key "' + key + '"');
}

// ── components ───────────────────────────────────────────────────────────────
for (const dir of ["ide/src/components/ide", "ide/src/components/ui"]) {
  for (const name of readdirSync(join(ROOT, dir)).sort()) {
    if (!name.endsWith(".tsx") || BRAND_MARK_FILES.has(name)) continue;
    const source = stripComments(readFileSync(join(ROOT, dir, name), "utf8")).replaceAll(
      "bg-black/10",
      "",
    );
    const hits = [...new Set(source.match(RAW_COLOUR) ?? [])];
    if (hits.length > 0) fail(dir + "/" + name + ": raw colour(s) " + hits.join(", "));
  }
}

if (failures.length > 0) {
  console.error("check-ide-theme: " + failures.length + " violation(s):");
  for (const message of failures) console.error("  " + message);
  process.exit(1);
}
console.log(
  "check-ide-theme: OK (" +
    attributes.length +
    " theme(s), " +
    REQUIRED_ROLES.length +
    " required roles, no raw colours in components)",
);
