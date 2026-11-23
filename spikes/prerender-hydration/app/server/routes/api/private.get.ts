import { createError, defineEventHandler } from "nitro/h3";

// A guarded endpoint: proves the fail-closed rule — its 401 body must never be
// written as a page (it is not in the prerender allowlist).
export default defineEventHandler(() => {
  throw createError({ statusCode: 401, statusMessage: "unauthorized" });
});
