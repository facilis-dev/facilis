#!/usr/bin/env node
// Read or restamp the version header of a vendored-CLI pack (the IDE's npm-pack.bin).
//
// Every Vivari packer writes the same frame — [u32le headerLen][headerJSON][file bytes…]
// then gzips the lot — and the header carries { version, files: [{ p, o, l }, …] }.
// Upstream's vendor-npm.mjs stamps the npm IT was written for (10.9.2), but
// scripts/dev/vendor-assets.sh packs THIS repo's npm pin (12.2.1, D-032) with it, so:
// read the stamp before packing to tell a current asset from one left by an older pin
// (the asset is a gitignored build artifact, and the kernel reports whatever the header
// says), and correct the stamp afterwards. Without the correction the header names a CLI
// the asset does not contain and the next bump would reuse it silently.
//
// Reimplemented here rather than imported from vendor/vivari: the submodule is read-only
// for us, upstream's helper only reads, and the frame shape is stable — it is the one
// packages/kernel-host/load-real-npm.js unpacks.
//
// Usage:
//   node scripts/dev/pack-version.mjs read <pack.bin>          # version, or "" if unreadable
//   node scripts/dev/pack-version.mjs stamp <pack.bin> <ver>   # rewrites the header version

import fs from "node:fs";
import zlib from "node:zlib";
import process from "node:process";

const USAGE = "usage: pack-version.mjs read <pack.bin> | stamp <pack.bin> <version>";

/** Split a pack into its parsed header and the untouched file-bytes region. */
function unpack(file) {
  const raw = zlib.gunzipSync(fs.readFileSync(file));
  const headerLen = raw.readUInt32LE(0);
  if (headerLen < 2 || headerLen > raw.length - 4) throw new Error("bad header length");
  const header = JSON.parse(raw.subarray(4, 4 + headerLen).toString("utf8"));
  if (!header || typeof header !== "object") throw new Error("bad header");
  return { header, body: raw.subarray(4 + headerLen) };
}

function read(file) {
  try {
    const { header } = unpack(file);
    return typeof header.version === "string" ? header.version : "";
  } catch {
    // Absent or corrupt counts as stale: the caller rebuilds, which is the safe side.
    return "";
  }
}

function stamp(file, version) {
  const { header, body } = unpack(file);
  header.version = version;
  // Only the version changes, so re-serialize the header and keep the file-bytes region
  // (the per-file offsets are relative to it) byte-for-byte. A shorter version moves the
  // body, which is why the header length is rewritten rather than patched in place.
  const head = Buffer.from(JSON.stringify(header), "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(head.length, 0);
  fs.writeFileSync(file, zlib.gzipSync(Buffer.concat([len, head, body]), { level: 9 }));
}

const [mode, file, version] = process.argv.slice(2);
try {
  if (mode === "read" && file) {
    process.stdout.write(read(file) + "\n");
  } else if (mode === "stamp" && file && version) {
    stamp(file, version);
    process.stderr.write(`[pack-version] stamped ${file} as ${version}\n`);
  } else {
    process.stderr.write(USAGE + "\n");
    process.exit(2);
  }
} catch (error) {
  process.stderr.write(`[pack-version] ${(error && error.message) || error}\n`);
  process.exit(1);
}
