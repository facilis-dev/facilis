import { createRequire } from "node:module";

// Temporary shim for kele23/vivari#2 (delete once the pinned kernel recovers a hostful file
// URL itself).
//
// PGlite's CJS build locates its wasm/data with new URL("file:" + __filename) — i.e. a
// single-slash file:/home/… URL. Chromium on Windows parses that form with the first path
// segment as the URL **host** (file://home/…, pathname /user/…), while Node and Chromium
// elsewhere read file:///home/…; PGlite's Emscripten glue then calls
// require("url").fileURLToPath(A) while initialising, and the runtime's strict rule throws
// ERR_INVALID_FILE_URL_HOST. The project database cannot boot there, and no PGlite option
// avoids that call.
//
// In a runtime running in a browser tab there are no file hosts, so a hostful file: URL can
// only be that misparse: recover the URL that was meant (the host is the first path segment)
// for the duration of the init, then put the builtin back.

/** The path a hostful file: URL was meant to name, or null for any other URL. */
export function recoverHostfulFileUrl(input: string | URL): string | null {
  const url = typeof input === "string" ? new URL(input) : input;
  if (url.protocol !== "file:") return null;
  if (url.hostname === "" || url.hostname === "localhost") return null;
  return decodeURIComponent("/" + url.hostname + url.pathname);
}

/**
 * Patch node:url's fileURLToPath for one init, restoring it afterwards. Returns null where the
 * export cannot be patched (the caller then runs unpatched and reports the original error).
 */
export function installFileUrlRecovery(): (() => void) | null {
  try {
    const url = createRequire(import.meta.url)("node:url") as {
      fileURLToPath: (input: string | URL) => string;
    };
    const original = url.fileURLToPath;
    if (typeof original !== "function") return null;
    url.fileURLToPath = (input: string | URL) => recoverHostfulFileUrl(input) ?? original(input);
    return () => {
      url.fileURLToPath = original;
    };
  } catch {
    return null;
  }
}
