import { defineConfig } from "nitro";

const astFallback = process.env.FACILIS_OPENAPI_AST_FALLBACK === "1";

export default defineConfig({
  serverDir: "./server",
  experimental: { openAPI: true },
  ...(astFallback
    ? {
        // Keep Nitro's own generation, but move it off the public path so the
        // framework can serve an AST-augmented spec at /_openapi.json.
        openAPI: { route: "/_facilis/openapi.json" },
        routes: { "/_openapi.json": "./server/openapi-facade.ts" },
      }
    : {}),
});
