#!/bin/sh
# Pack the workspace-only @facilis/* packages into URL-installable tarballs for the IDE.
#
# Why: a generated Facilis project runs inside the IDE's WebContainer and performs a real
# `npm install` there. @facilis/* are not published (O-006 is deferred to Phase 6), so the
# IDE serves pnpm-packed tarballs from its own origin and the Facilis template's package.json
# points at ${origin}/vendor/facilis/facilis-<pkg>-<version>.tgz. `pnpm pack` rewrites the
# workspace:* interdependencies to the real version (0.0.0 today) while packing, which is what
# lets plain npm accept them.
#
# Each tarball is then repacked so its `exports` resolve to the compiled dist/*.js instead of
# the workspace src/*.ts. The generated project's Vite config is loaded with
# `--configLoader native` inside the WebContainer (Vite's own config bundler cannot run there),
# and a native ESM loader refuses to strip types from files under node_modules
# (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING) — the config imports @facilis/nitro/vite, so it
# must be JS. This is why the script builds the packages first and why the workspace source is
# left untouched: only the packed copy is rewritten.
#
# Usage: scripts/dev/vendor-facilis-deps.sh [--all]
#   --all also packs @facilis/ai and @facilis/blocks (not part of the default project templates).
set -eu

REPO_ROOT=$(cd "$(dirname "$0")/../.." && pwd)
DST="$REPO_ROOT/ide/public/vendor/facilis"

# Pinned set: exactly the packages the Facilis template declares. Keep it in sync with the
# template's package.json when the template's dependency set changes.
PKGS="core db auth analyze nitro time"

log() { printf '[vendor-facilis-deps] %s\n' "$*" >&2; }

case "${1:-}" in
  "") ;;
  --all) PKGS="$PKGS ai blocks" ;;
  *)
    log "unknown option: $1"
    log "usage: $0 [--all]"
    exit 2
    ;;
esac

command -v pnpm >/dev/null 2>&1 || {
  log "pnpm not found: run 'corepack enable' (this repo pins pnpm 12.15.0)"
  exit 1
}

# Idempotent: never mix a stale tarball (or one whose package was removed from PKGS) with the
# fresh set, because the IDE serves every *.tgz it finds in this directory.
mkdir -p "$DST"
rm -f "$DST"/*.tgz

fail=0
log "packing ${PKGS} -> ${DST#"$REPO_ROOT"/}"
printf '%-16s %-8s %8s  %s\n' package version size tarball >&2

for pkg in $PKGS; do
  manifest="$REPO_ROOT/packages/$pkg/package.json"
  if [ ! -f "$manifest" ]; then
    log "FAIL: missing $manifest"
    exit 1
  fi
  version=$(node -p "JSON.parse(require('node:fs').readFileSync('$manifest', 'utf8')).version")
  tgz="$DST/facilis-$pkg-$version.tgz"

  # Build first: the tarball must carry a compiled dist/ (see the header for why).
  ( cd "$REPO_ROOT" && pnpm --filter "@facilis/$pkg" build >/dev/null )

  # Run from the workspace root so the script works from any cwd (pnpm pack needs the workspace).
  ( cd "$REPO_ROOT" && pnpm --filter "@facilis/$pkg" pack --pack-destination "$DST" >/dev/null )

  if [ ! -f "$tgz" ]; then
    log "FAIL: pnpm pack did not produce ${tgz##*/}"
    fail=1
    continue
  fi

  # Repoint the packed manifest's exports at dist/. The workspace source keeps its src entry
  # points (bundlers strip types there); only the tarball is rewritten, so nothing about local
  # development changes.
  stage=$(mktemp -d)
  tar xzf "$tgz" -C "$stage"
  node -e '
const fs = require("node:fs");
const path = require("node:path");
const file = process.argv[1];
const pkgDir = path.dirname(file);
const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
const toDist = (value) =>
  typeof value === "string" && value.startsWith("./src/")
    ? "./dist/" + value.slice("./src/".length).replace(/\.ts$/, ".js")
    : value;
const rewrite = (node) => {
  if (typeof node === "string") return toDist(node);
  if (Array.isArray(node)) return node.map(rewrite);
  if (node && typeof node === "object")
    return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, rewrite(value)]));
  return node;
};
manifest.exports = rewrite(manifest.exports);
// Classic (node10) resolution — what the IDE language service uses — ignores "exports".
// The root entry points are mirrored as main/types so the package resolves there too.
const root = manifest.exports && manifest.exports["."];
if (typeof root === "string" && root.startsWith("./dist/") && root.endsWith(".js")) {
  manifest.main = root;
  manifest.types = root.slice(0, -3) + ".d.ts";
}
fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n");

// Declaration emit keeps the SOURCE specifier ("../button.tsx"), which no consumer can
// resolve out of dist/ and which would name a file the tarball does not have. Map them to
// the emitted .js (TypeScript resolves .js -> .d.ts) and drop the component CSS imports a
// declaration file has no use for.
const distDir = path.join(pkgDir, "dist");
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(target);
      continue;
    }
    if (!target.endsWith(".d.ts")) continue;
    const before = fs.readFileSync(target, "utf8");
    const after = before
      .replace(/^(import|export)([^;\n]*?from\s+)(")(\.{1,2}\/[^"]+)\.tsx?\3/gm, "$1$2$3$4.js$3")
      .replace(/^import\s+"\.{1,2}\/[^"]+\.css";\n?/gm, "");
    if (after !== before) fs.writeFileSync(target, after);
  }
};
if (fs.existsSync(distDir)) walk(distDir);
' "$stage/package/package.json"
  tar czf "$tgz" -C "$stage" package
  rm -rf "$stage"

  # Verify the tarball itself, not the workspace source: these are the properties the in-VM
  # URL install and the in-VM native config load both depend on.
  listing=$(tar tzf "$tgz")
  packed=$(tar xzf "$tgz" -O package/package.json)
  problem=
  if ! printf '%s\n' "$listing" | grep -qx 'package/package.json'; then
    problem="package.json missing from tarball"
  elif printf '%s\n' "$packed" | grep -q 'workspace:'; then
    problem="package.json still contains a workspace: specifier"
  elif printf '%s\n' "$packed" | grep -q '"\./src/'; then
    problem="exports still point at src/ (must resolve to dist/ for the in-VM config load)"
  elif ! printf '%s\n' "$packed" | grep -q '"\./dist/'; then
    problem="exports do not point at dist/"
  elif ! printf '%s\n' "$listing" | grep -qx 'package/dist/index.js'; then
    problem="dist/index.js missing from tarball (was the package built?)"
  fi

  bytes=$(wc -c < "$tgz")
  if [ -n "$problem" ]; then
    log "FAIL: ${tgz##*/}: $problem"
    fail=1
    continue
  fi
  printf '%-16s %-8s %7s KB  %s\n' \
    "@facilis/$pkg" "$version" "$(awk -v b="$bytes" 'BEGIN { printf "%.0f", b / 1024 }')" \
    "${tgz##*/}" >&2
done

if [ "$fail" -ne 0 ]; then
  log "FAILED: fix the violations above"
  exit 1
fi

log "done: ${PKGS} served by the IDE at /vendor/facilis/*.tgz"
ls -l "$DST"/*.tgz >&2
