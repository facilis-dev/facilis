#!/bin/sh
# Produce the build-time assets the browser kernel fetches from /vendor/:
#   ide/public/vendor/npm-pack.bin      real npm@10.9.2 CLI packed for the VFS
#   ide/public/vendor/sqlite/sqlite3.wasm
#
# Upstream builds these with scripts/vendor-*.mjs into packages/studio/public/vendor
# (gitignored, and that directory belongs to the read-only submodule), so this script
# runs the upstream generators and copies the result into the IDE's public/.
#
# Usage: scripts/dev/vendor-assets.sh [--all]
#   --all also vendors yarn, pnpm, corepack, tsgo, pyodide and ruff (~500 MB; only
#   needed when the Studio must run those tools inside the WebContainer).
# Env: FACILIS_TOOLING_DIR (default /tmp/facilis-dev)
set -eu

REPO_ROOT=$(cd "$(dirname "$0")/../.." && pwd)
VIVARI="$REPO_ROOT/vendor/vivari"
TC=${FACILIS_TOOLING_DIR:-/tmp/facilis-dev}
NPM_VERSION=10.9.2
PNPM_VERSION=9.15.9
SRC="$VIVARI/packages/studio/public/vendor"
DST="$REPO_ROOT/ide/public/vendor"

log() { printf '[vendor-assets] %s\n' "$*" >&2; }
mkdir -p "$TC/npm-vendor/node_modules" "$DST"

# 1. npm CLI: upstream's generator shells out to a host `npm`, which minimal images
#    do not have. Its tarball already contains the bundled dependency tree the packer
#    walks, so extract that instead.
if [ ! -f "$TC/npm-vendor/node_modules/npm/bin/npm-cli.js" ]; then
  log "fetching npm@$NPM_VERSION tarball"
  curl -fsSL --retry 3 --max-time 120 -o "$TC/npm-vendor/npm.tgz" \
    "https://registry.npmjs.org/npm/-/npm-$NPM_VERSION.tgz"
  mkdir -p "$TC/npm-vendor/node_modules/npm"
  tar xzf "$TC/npm-vendor/npm.tgz" -C "$TC/npm-vendor/node_modules/npm" --strip-components=1
fi

# 2. Pack it with upstream's generator (also patches Arborist's #loadPeerSet, which the
#    kernel needs; building the pack any other way is not equivalent).
VENDOR_DIR="$TC/npm-vendor" node "$VIVARI/scripts/vendor-npm.mjs"

# 3. pnpm CLI, same tarball trick and load-bearing for Vite 8: rolldown's in-VM fallback
#    runs \`pnpm i @rolldown/binding-wasm32-wasi\` when a project's dev server starts, so
#    without this asset every Vite template dies with "Cannot find native binding".
if [ ! -f "$TC/pnpm-vendor/node_modules/pnpm/bin/pnpm.cjs" ]; then
  log "fetching pnpm@$PNPM_VERSION tarball"
  curl -fsSL --retry 3 --max-time 120 -o "$TC/pnpm-vendor/pnpm.tgz" \
    "https://registry.npmjs.org/pnpm/-/pnpm-$PNPM_VERSION.tgz"
  mkdir -p "$TC/pnpm-vendor/node_modules/pnpm"
  tar xzf "$TC/pnpm-vendor/pnpm.tgz" -C "$TC/pnpm-vendor/node_modules/pnpm" --strip-components=1
fi
VV_VENDOR_PNPM_DIR="$TC/pnpm-vendor" node "$VIVARI/scripts/vendor-pnpm.mjs"

# 4. sqlite3.wasm is copied from the runtime's vendored artifact by upstream's script.
node "$VIVARI/scripts/vendor-sqlite.mjs"

if [ "${1:-}" = "--all" ]; then
  # yarn/corepack/tsgo/pyodide/ruff generators still shell out to a host npm/npx; keep
  # them opt-in so this script stays runnable with nothing but curl + tar + node.
  for tool in yarn corepack tsgo pyodide ruff; do
    log "vendoring $tool (large download, needs host npm)"
    node "$VIVARI/scripts/vendor-$tool.mjs"
  done
fi

# 5. Publish into the IDE. Only the assets this app serves are copied; the upstream
#    checkout under vendor/vivari stays pristine (its public/vendor is gitignored).
mkdir -p "$DST/sqlite"
cp "$SRC/npm-pack.bin" "$DST/npm-pack.bin"
cp "$SRC/pnpm-pack.bin" "$DST/pnpm-pack.bin"
cp "$SRC/sqlite/sqlite3.wasm" "$DST/sqlite/sqlite3.wasm"

log "done:"
ls -l "$DST/npm-pack.bin" "$DST/pnpm-pack.bin" "$DST/sqlite/sqlite3.wasm" >&2
