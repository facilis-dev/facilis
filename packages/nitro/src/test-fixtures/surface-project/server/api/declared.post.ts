import { defineRawRoute } from "@facilis.dev/core";

// The declared fixture: a raw route with a reason, auth none, and an explicit rawDb use.
export default defineRawRoute(
  { reason: "signed vendor callback; raw body and no session", auth: "none" },
  async (event, ctx) => {
    const leaked = "db" in (event.context.facilis ?? {});
    ctx.rawDb({ reason: "vendor payload upsert" });
    return { ok: true, leaked, rawDb: typeof ctx.rawDb === "function" };
  },
);
