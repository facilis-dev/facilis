import { z } from "zod";
import { defineAuthorizedHandler } from "@facilis/core";
import { sendStoredFile } from "@facilis/nitro/storage";

// Token-only download proxy (D-053): GET carries no session cookie by design, so img tags
// and shared links work. The signed token is what proves the caller may read this file.
// Still a defineAuthorizedHandler: `permission: []` keeps the contract uniform and the
// wrapper resolves the tenant the token was issued for.
export default defineAuthorizedHandler(
  {
    permission: [],
    params: z.object({ id: z.uuid() }),
    query: z.object({ token: z.string().min(1) }),
    dbTables: ["facilis_files"],
    description: "Stream or redirect to a stored file when the signed token is valid.",
  },
  async (event, { params, query, db, storage }) => {
    return sendStoredFile({
      db,
      storage,
      fileId: params.id,
      token: query.token,
      tenantId: event.context.facilis?.defaultTenantId,
    });
  },
);
