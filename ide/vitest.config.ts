// Vitest needs the app's Vite config (aliases, plugins, raw imports) and, unlike the
// app build, the real text of stylesheets: the generated template inlines
// examples/todo-app's CSS through ?raw, which Vitest stubs to "" unless CSS is enabled.
import { mergeConfig } from "vite";
import { defineConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

export default mergeConfig(
  viteConfig,
  defineConfig({ test: { css: true } }),
);
