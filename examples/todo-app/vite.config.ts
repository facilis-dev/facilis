import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { facilis } from "@facilis/nitro/vite";

// One dev server: Vite serves the client, Nitro runs as a plugin on the same origin
// (spec 10.6). facilis() must come before nitro() so the Facilis Nitro module is
// attached to the plugin chain before Nitro boots.
export default defineConfig({
  plugins: [facilis(), nitro(), react()],
  resolve: {
    alias: { "~": new URL(".", import.meta.url).pathname },
  },
});
