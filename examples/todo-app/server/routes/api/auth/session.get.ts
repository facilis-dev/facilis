import { defineAuthorizedHandler, fail } from "@facilis/core";

export default defineAuthorizedHandler(
  {
    permission: [],
    // The session was resolved by the framework middleware: this handler reads no relation.
    dbTables: [],
    description: "Return the current session, or authenticated: false.",
  },
  async (event) => {
    const auth = event.context.auth ?? null;
    if (auth === null) return { authenticated: false };

    if (typeof auth.userId !== "string") return fail("internal_error");

    return {
      authenticated: true,
      userId: auth.userId,
      roles: auth.roles,
      permissions: auth.permissions,
    };
  },
);
