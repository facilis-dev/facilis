import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { nitro } from "nitro/vite";
import react from "@vitejs/plugin-react";
import { facilisOpenApiAstFallback } from "./tools/facilis-openapi-ast-fallback.ts";

// Default plugin list matches SPEC Appendix E: [facilis(), nitro(), react()].
// The AST-pass prototype stands in for facilis() when the env flag is set.
const astFallback = process.env.FACILIS_OPENAPI_AST_FALLBACK === "1";

export default defineConfig({
  plugins: [
    ...(astFallback
      ? [
          facilisOpenApiAstFallback({
            routesDir: fileURLToPath(new URL("./server/routes", import.meta.url)),
          }),
        ]
      : []),
    nitro(),
    react(),
  ],
});
