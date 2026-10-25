#!/bin/sh
# Build the Vivari kernel Rust->Wasm packages that ide/ imports:
#   vendor/vivari/packages/{vfs,codec,crypto}/pkg/vivari_*_bg.wasm
#
# Upstream ships these as build artifacts (gitignored), never as sources, so a fresh
# checkout cannot boot the Studio without them. This script reproduces upstream's
# pipeline without root and without a preinstalled toolchain:
#   rustup (wasm32-unknown-unknown) + wasm-pack + wasm-bindgen (pinned by Cargo.lock)
#   plus a self-contained Zig cc when the image has no host C toolchain, which Rust
#   needs to link build scripts/proc-macros for the host.
#
# Usage: scripts/dev/build-kernel-wasm.sh [--force]
# Env:   FACILIS_TOOLING_DIR (default /tmp/facilis-dev), FACILIS_OFFLINE=1 to skip downloads
# Cost:  ~2 min downloads + ~100 s of cargo builds on 16 cores; ~2.3 GB in TOOLING_DIR.
set -eu

REPO_ROOT=$(cd "$(dirname "$0")/../.." && pwd)
VIVARI="$REPO_ROOT/vendor/vivari"
TC=${FACILIS_TOOLING_DIR:-/tmp/facilis-dev}
DL="$TC/downloads"
BIN="$TC/bin"
WP_VERSION=0.13.1
ZIG_VERSION=0.17.0
# wasm-bindgen's prebuilt release must match the version Cargo.lock pins exactly.
WB_VERSION=$(awk '/^name = "wasm-bindgen"$/ {found=1; next} found && /^version =/ {gsub(/[^0-9.]/, ""); print; exit}' "$VIVARI/packages/vfs/Cargo.lock")
FORCE=${1:-}

mkdir -p "$DL" "$BIN"

log() { printf '[kernel-wasm] %s\n' "$*" >&2; }
fetch() { # fetch <url> <dest>
  [ -s "$2" ] && { log "cached $(basename "$2")"; return 0; }
  log "downloading $1"
  curl -fsSL --retry 3 --max-time 300 -o "$2.part" "$1"
  mv "$2.part" "$2"
}

if [ -z "$WB_VERSION" ]; then
  echo "cannot read wasm-bindgen version from $VIVARI/packages/vfs/Cargo.lock" >&2
  exit 1
fi

# 1. rustup + wasm32 target, entirely inside TOOLING_DIR (the sandbox $HOME may be read-only).
export RUSTUP_HOME="$TC/rustup" CARGO_HOME="$TC/cargo"
if [ ! -x "$CARGO_HOME/bin/rustc" ]; then
  fetch https://sh.rustup.rs "$DL/rustup-init.sh"
  sh "$DL/rustup-init.sh" -y --profile minimal --default-toolchain stable --no-modify-path
fi
"$CARGO_HOME/bin/rustup" target add wasm32-unknown-unknown >/dev/null

# 2. wasm-pack (prebuilt musl; cargo install would need a C toolchain).
if [ ! -x "$TC/wasm-pack/wasm-pack" ]; then
  fetch "https://github.com/rustwasm/wasm-pack/releases/download/v$WP_VERSION/wasm-pack-v$WP_VERSION-x86_64-unknown-linux-musl.tar.gz" "$DL/wasm-pack.tar.gz"
  tar xzf "$DL/wasm-pack.tar.gz" -C "$TC"
  mv "$TC/wasm-pack-v$WP_VERSION-x86_64-unknown-linux-musl" "$TC/wasm-pack"
fi
WP="$TC/wasm-pack/wasm-pack"

# 3. host linker for Rust build scripts: use cc if the image has one, otherwise Zig.
if ! command -v cc >/dev/null 2>&1; then
  if [ ! -x "$TC/zig/zig" ]; then
    fetch "https://ziglang.org/download/$ZIG_VERSION/zig-x86_64-linux-$ZIG_VERSION.tar.xz" "$DL/zig.tar.xz"
    if command -v xz >/dev/null 2>&1; then
      xz -dc "$DL/zig.tar.xz" > "$DL/zig.tar"
    else
      # Minimal images ship tar+gzip but no xz; busybox gives us a static xzcat.
      fetch https://busybox.net/downloads/binaries/1.35.0-x86_64-linux-musl/busybox "$DL/busybox"
      chmod +x "$DL/busybox"
      "$DL/busybox" xzcat "$DL/zig.tar.xz" > "$DL/zig.tar"
    fi
    tar xf "$DL/zig.tar" -C "$TC"
    mv "$TC/zig-x86_64-linux-$ZIG_VERSION" "$TC/zig"
    rm -f "$DL/zig.tar" "$DL/zig.tar.xz"
  fi
  for tool in cc c++; do
    cat > "$BIN/$tool" <<EOF
#!/bin/sh
export ZIG_GLOBAL_CACHE_DIR="$TC/zig-cache"
export ZIG_LOCAL_CACHE_DIR="$TC/zig-local-cache"
exec "$TC/zig/zig" $tool "\$@"
EOF
    chmod +x "$BIN/$tool"
  done
  export CC="$BIN/cc" CXX="$BIN/c++"
  export CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER="$BIN/cc"
  export ZIG_GLOBAL_CACHE_DIR="$TC/zig-cache" ZIG_LOCAL_CACHE_DIR="$TC/zig-local-cache"
fi

# 4. wasm-bindgen for the exact version Cargo.lock pins: wasm-pack otherwise falls
#    back to `cargo install wasm-bindgen-cli`, which needs ring's C build and fails
#    on images without a C toolchain. Seed wasm-pack's cache layout directly.
export WASM_PACK_CACHE="$TC/wasm-pack-cache"
WB_CACHE="$WASM_PACK_CACHE/.wasm-bindgen-cargo-install-$WB_VERSION"
if [ ! -x "$WB_CACHE/bin/wasm-bindgen" ]; then
  fetch "https://github.com/rustwasm/wasm-bindgen/releases/download/$WB_VERSION/wasm-bindgen-$WB_VERSION-x86_64-unknown-linux-musl.tar.gz" "$DL/wasm-bindgen.tar.gz"
  tar xzf "$DL/wasm-bindgen.tar.gz" -C "$TC"
  mkdir -p "$WB_CACHE/bin"
  cp "$TC/wasm-bindgen-$WB_VERSION-x86_64-unknown-linux-musl/wasm-bindgen" "$WB_CACHE/bin/wasm-bindgen"
  chmod +x "$WB_CACHE/bin/wasm-bindgen"
fi

# 5. Build the three crates (web target is what the browser kernel loads).
export PATH="$CARGO_HOME/bin:$BIN:$PATH"
for crate in vfs codec crypto; do
  out="$VIVARI/packages/$crate/pkg"
  if [ "$FORCE" != "--force" ] && [ -s "$out/vivari_${crate}_bg.wasm" ]; then
    log "already built: $crate ($out)"; continue
  fi
  log "building $crate (first run downloads wasm-opt/binaryen)"
  CARGO_TARGET_DIR="$TC/target-$crate" \
    "$WP" build "$VIVARI/packages/$crate" --target web --out-dir pkg
done

log "done:"
ls -l "$VIVARI"/packages/*/pkg/vivari_*_bg.wasm >&2
