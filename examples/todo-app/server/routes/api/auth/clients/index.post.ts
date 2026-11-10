import { z } from "zod";
import { createApiClient } from "@facilis/auth";
import { defineAuthorizedHandler, fail } from "@facilis/core";
import config from "~/facilis.config";

const createClientSchema = z.object({
  name: z.string().min(1).max(80),
  role: z.string().min(1),
});

export default defineAuthorizedHandler(
  {
    permission: ["api-clients:write"],
    body: createClientSchema,
    // The role must be declared in facilis.config.ts; the service user, its role assignment
    // and the client row are framework auth state, so the create runs elevated.
    dbTables: ["roles", "users", "user_roles", "api_clients"],
    description: "Create an API client; the secret is returned once and never again.",
  },
  async (_event, { auth, body, log, sudo }) => {
    // Validate against the static config first: no elevated work for an undeclared role.
    if (!Object.hasOwn(config.auth.roles, body.role)) {
      log.audit({
        operation: "auth:api-clients:create",
        outcome: "failed",
        errorCode: "invalid_input",
      });
      return fail("invalid_input", { role: "unknown_role" });
    }

    const created = await sudo(
      {
        operation: "auth:api-clients:create",
        reason: "roles is system-only and the service user is framework state",
        tables: ["roles", "users", "user_roles", "api_clients"],
      },
      (systemDb) =>
        createApiClient(systemDb, {
          name: body.name,
          role: body.role,
          createdBy: auth.userId,
        }),
    );

    // The client id is public; the secret and its hash are credentials, so only the id and
    // the validated role are audited.
    log.audit({
      operation: "auth:api-clients:create",
      outcome: "succeeded",
      details: { clientId: created.clientId, role: created.role },
    });

    // The plaintext secret is shown once, in this response: only its SHA-256 is stored.
    return {
      id: created.id,
      clientId: created.clientId,
      secret: created.secret,
      name: created.name,
      role: created.role,
    };
  },
);
