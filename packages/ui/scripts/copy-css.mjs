#!/usr/bin/env node
/**
 * Copies the colocated component stylesheets into dist/ after tsc.
 *
 * tsc emits the JS modules (which keep their CSS import statements) but never copies non-TS
 * assets; a packed tarball ships dist/ and must contain the CSS next to those modules.
 */
import { copyFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const srcDir = join(packageRoot, "src");
const distDir = join(packageRoot, "dist");

function stylesheetsIn(directory) {
  return readdirSync(directory, { recursive: true })
    .map(String)
    .filter((file) => file.endsWith(".css"));
}

const stylesheets = stylesheetsIn(srcDir);
if (stylesheets.length === 0) {
  console.error("copy-css: no stylesheets found in src/");
  process.exitCode = 1;
} else {
  // Drop stale copies first so a deleted stylesheet cannot linger in the published tarball.
  for (const file of stylesheetsIn(distDir)) {
    rmSync(join(distDir, file), { force: true });
  }

  for (const file of stylesheets) {
    const target = join(distDir, file);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(srcDir, file), target);
  }

  console.log("copy-css: copied " + stylesheets.length + " stylesheet(s) into dist/");
}
