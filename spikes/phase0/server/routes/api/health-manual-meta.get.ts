import { defineHandler, defineRouteMeta } from "nitro";

// A16 control: metadata written at the top level of the route file, with the
// wrapper used only as the handler implementation (no meta inside the wrapper).
defineRouteMeta({
  openAPI: {
    description: "Manual top-level metadata probe",
    "x-permission": "todos:read",
    "x-db-tables": ["todos"],
    "x-db-columns": ["todos.title"],
  },
});

async function impl(_event: unknown) {
  return { ok: true, variant: "manual-meta" };
}

export default defineHandler(impl);
