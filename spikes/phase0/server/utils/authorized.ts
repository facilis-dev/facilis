import { defineHandler, defineRouteMeta } from "nitro";

export interface AuthorizedHandlerConfig {
  permission: string | string[];
  dbTables: string[];
  dbColumns?: string[];
  description?: string;
}

export interface AuthorizedHandlerContext {
  auth: { userId: string; tenantId: string; roles: string[]; permissions: string[] };
  body: unknown;
  query: unknown;
  params: unknown;
  db: unknown;
}

/**
 * Phase 0 prototype of @facilis/core#defineAuthorizedHandler.
 *
 * It emits route metadata by calling defineRouteMeta *inside the wrapper body*
 * (the shape the spec assumes: see SPEC §6.9, §7.4, Appendix A16). This file
 * exists to prove or disprove that Nitro's build-time scanner picks that up.
 */
export function defineAuthorizedHandler(
  config: AuthorizedHandlerConfig,
  handler: (event: unknown, ctx: AuthorizedHandlerContext) => Promise<unknown> | unknown,
) {
  defineRouteMeta({
    openAPI: {
      description: config.description,
      "x-permission": config.permission,
      "x-db-tables": config.dbTables,
      "x-db-columns": config.dbColumns ?? [],
    },
  });

  return defineHandler(async (event: unknown) => {
    // Phase 0 stub: no real auth/session or DB yet.
    const ctx: AuthorizedHandlerContext = {
      auth: {
        userId: "00000000-0000-0000-0000-000000000001",
        tenantId: "00000000-0000-0000-0000-000000000002",
        roles: ["admin"],
        permissions: ["todos:read"],
      },
      body: undefined,
      query: {},
      params: {},
      db: null,
    };
    return handler(event, ctx);
  });
}
