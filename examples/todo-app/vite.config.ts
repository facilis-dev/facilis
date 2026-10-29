import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { facilis } from "@facilis/nitro/vite";

// One dev server: Vite serves the client and facilis() mounts Nitro on the same
// origin (spec 10.6). Nitro's options are read from facilis.config.ts, so this file
// never names Nitro itself.
export default defineConfig({
  plugins: [facilis(), react()],
  resolve: {
    alias: { "~": new URL(".", import.meta.url).pathname },
  },
});
