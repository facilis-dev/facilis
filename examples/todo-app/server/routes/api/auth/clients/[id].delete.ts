import { z } from "zod";
import { revokeApiClient } from "@facilis/auth";
import { defineAuthorizedHandler, fail } from "@facilis/core";

export default defineAuthorizedHandler(
  {
    permission: ["api-clients:write"],
    params: z.object({ id: z.uuid() }),
    // One client row plus every token issued to it is revoked in the same transaction.
    dbTables: ["api_clients", "api_tokens"],
    description: "Revoke an API client and its issued tokens.",
  },
  async (_event, { params, db, log }) => {
    const revoked = await revokeApiClient(db, params.id);
    if (!revoked) {
      log.audit({
        operation: "auth:api-clients:revoke",
        outcome: "failed",
        errorCode: "not_found",
        details: { id: params.id },
      });
      return fail("not_found");
    }

    log.audit({
      operation: "auth:api-clients:revoke",
      outcome: "succeeded",
      details: { id: params.id },
    });
    return { ok: true };
  },
);
