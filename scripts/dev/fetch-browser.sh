#!/bin/sh
# Install a headless Chromium for scripts/dev/smoke-ide.mjs without root.
#
# The sandbox image has no browser, no system fonts and no writable $HOME, and we
# cannot apt-get install as an unprivileged user. Debian/Ubuntu still lets us
# *download* the packages and unpack them into a private sysroot, so the browser and
# its shared libraries stay self-contained under FACILIS_TOOLING_DIR.
#
# Usage: scripts/dev/fetch-browser.sh
# Env:   FACILIS_TOOLING_DIR (default /tmp/facilis-dev)
#        FACILIS_CHROME / FACILIS_BROWSER_SYSROOT — bypass this script entirely with
#        an existing chrome binary (then sysroot may stay empty).
# Notes: Debian trixie checked; the chromium package is ~92 MB + ~110 MB of deps.
set -eu

TC=${FACILIS_TOOLING_DIR:-/tmp/facilis-dev}
ROOT="$TC/browser"
SYS="$ROOT/sysroot"
APT="$ROOT/apt"
export APT_CONFIG="$ROOT/apt.conf"

log() { printf '[browser] %s\n' "$*" >&2; }
mkdir -p "$APT/lists/partial" "$APT/cache/archives/partial" "$SYS" "$ROOT/chrome" "$ROOT/home"

cat > "$APT_CONFIG" <<EOF
Dir::State "$APT";
Dir::State::lists "$APT/lists";
Dir::State::status "/var/lib/dpkg/status";
Dir::Cache "$APT/cache";
Dir::Cache::archives "$APT/cache/archives";
Dir::Etc::sourcelist "/dev/null";
Dir::Etc::sourceparts "/etc/apt/sources.list.d";
DPkg::Lock::Timeout "5";
EOF

log "downloading package lists"
apt-get update -o Debug::NoLocking=true >&2

log "downloading chromium + dependency closure (~200 MB)"
apt-get -o Debug::NoLocking=true -o APT::Get::Download-Only=true install -y \
  --no-install-recommends chromium >&2

# Fonts matter: Chromium measures every line box from an installed font, so without
# one the UI renders zero-height text and even innerText comes back empty.
log "downloading fonts + fontconfig"
apt-get -o Debug::NoLocking=true -o APT::Get::Download-Only=true install -y \
  --no-install-recommends fonts-dejavu-core fontconfig fontconfig-config >&2

log "unpacking into $SYS"
cd "$APT/cache/archives"
for deb in *.deb; do dpkg-deb -x "$deb" "$SYS"; done
cd - >/dev/null

# Point fontconfig at the private sysroot instead of the absent /usr/share/fonts.
cat > "$ROOT/fonts.conf" <<EOF
<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>$SYS/usr/share/fonts</dir>
  <cachedir>$ROOT/fonts-cache</cachedir>
  <include ignore_missing="yes">$SYS/etc/fonts/conf.d</include>
</fontconfig>
EOF
mkdir -p "$ROOT/fonts-cache"

ln -sfn "$SYS/usr/lib/chromium/chromium" "$ROOT/chrome/chrome"

# Verify exactly the way the smoke test will launch it.
export LD_LIBRARY_PATH="$SYS/usr/lib/x86_64-linux-gnu:$SYS/usr/lib/x86_64-linux-gnu/pulseaudio:$SYS/lib/x86_64-linux-gnu:$SYS/usr/lib"
export FONTCONFIG_FILE="$ROOT/fonts.conf"
export HOME="$ROOT/home"
log "chrome version: $("$ROOT/chrome/chrome" --version 2>&1 | tail -1)"
