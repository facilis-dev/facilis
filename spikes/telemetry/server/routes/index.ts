import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { defineHandler } from "nitro";

/** Serves the built spike page (the runner bundles `client/` into `public/`). */
export default defineHandler(async () => {
  const html = await readFile(join(process.cwd(), "public/index.html"), "utf8");
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
});
