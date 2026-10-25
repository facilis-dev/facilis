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
