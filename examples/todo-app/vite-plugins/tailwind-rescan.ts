import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin, ViteDevServer } from "vite";

/*
 * Workaround for tailwindlabs/tailwindcss#20605 in the WebContainer.
 *
 * The VM runs as wasm32, so @tailwindcss/oxide resolves to its WASI build. There the v4
 * scanner misses a NEW utility class added to a .ts/.tsx file: the compiler/scanner pair only
 * gets recreated when a build dependency's mtime moves and the CSS module is rebuilt. Reloading
 * the CSS module alone is not enough (the WASI scanner instance keeps the old candidate set),
 * so this dev-only plugin re-writes the stylesheet with its own bytes after a debounced source
 * change: the mtime moves, content does not, and Vite's own change handling rebuilds the CSS
 * with a fresh scanner. The spike in spikes/template-v2 verified this end to end.
 *
 * The native host scanner does not have the bug, so configureServer is a no-op off wasm32,
 * and apply "serve" keeps the plugin out of `vite build`. A forked Tailwind is avoided: this
 * is a transient scanner bug in one wasm environment, and a small dev plugin keeps generated
 * projects on upstream releases.
 */

const RESCAN_DEBOUNCE_MS = 60;
const SOURCE_FILE = /\.(?:ts|tsx)$/;

function touchStylesheet(server: ViteDevServer, stylesEntry: string): void {
  try {
    // Re-write the bytes we just read: the watcher sees a change and mtime moves. Reading
    // first means a concurrent user edit is preserved; the content is byte-identical.
    writeFileSync(stylesEntry, readFileSync(stylesEntry));
  } catch (error) {
    server.config.logger.warn("[facilis] tailwind rescan failed: " + String(error));
  }
}

export function tailwindRescanInVm(): Plugin {
  return {
    name: "facilis:tailwind-rescan-in-vm",
    apply: "serve",
    configureServer(server) {
      // @types/node does not model the VM's "wasm32" arch, so compare the runtime value.
      if ((process.arch as string) !== "wasm32") return;

      const stylesEntry = resolve(server.config.root, "src/styles.css");
      let timer: ReturnType<typeof setTimeout> | null = null;

      const schedule = (file: string) => {
        // CSS changes already make Tailwind rescan; only script edits need the nudge.
        if (!SOURCE_FILE.test(file)) return;
        if (timer !== null) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = null;
          touchStylesheet(server, stylesEntry);
        }, RESCAN_DEBOUNCE_MS);
      };

      // Adds and deletes matter too: a new component file can introduce new classes.
      server.watcher.on("add", schedule);
      server.watcher.on("change", schedule);
      server.watcher.on("unlink", schedule);
    },
  };
}
