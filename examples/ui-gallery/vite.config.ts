import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Dev-only: the sandbox serves dev servers through the facilis.home HTTPS proxy, and Vite 8
  // rejects unknown Host headers. A normal deploy never uses this.
  server: {
    allowedHosts: ["facilis.home", ".facilis.home", "dsh.home"],
  },
});
