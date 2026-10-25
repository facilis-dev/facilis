import { defineHandler, defineRouteMeta } from "nitro";

defineRouteMeta({
  openAPI: {
    tags: ["facilis-spike"],
    description: "Health probe (control case: top-level defineRouteMeta macro)",
    responses: {
      200: { description: "Service is healthy" },
    },
  },
});

export default defineHandler(() => {
  return { status: "ok", service: "facilis-phase0-spike" };
});
