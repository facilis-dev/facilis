import type { H3Event } from "nitro";
import type { FacilisEventContext } from "@facilis/core";

import { getBootstrap } from "../runtime/bootstrap.ts";
import { readDefaultTenantId } from "../runtime/tenant.ts";

/**
 * facilis-context middleware (contracts §4.1/§8).
 *
 * Boots the runtime lazily and exposes `event.context.facilis` — including the
 * single-tenant fallback id used to scope unauthenticated requests. When the db is
 * unavailable the context stays unset, so authorized handlers answer `db_unavailable`
 * instead of running unscoped.
 */
const handler = async (event: H3Event): Promise<void> => {
  const state = await getBootstrap();
  if (state.db === null) return;

  const context = event.context as FacilisEventContext;
  context.facilis = { db: state.db, defaultTenantId: readDefaultTenantId() };
};

export default handler;
