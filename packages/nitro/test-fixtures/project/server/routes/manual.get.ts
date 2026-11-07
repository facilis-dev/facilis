// Unwrapped handler: the analyzer lists it as an invalid route (there is no
// defineRouteMeta fallback anymore), so the adapter reports unresolved metadata.
import { defineHandler, defineRouteMeta } from "nitro";

export default defineHandler(() => ({ ok: true }));

defineRouteMeta({
  openAPI: {
    description: "Manual top-level metadata.",
    "x-permission": "todos:read",
    "x-db-tables": ["todos"],
    "x-db-columns": ["todos.title"],
  },
});
