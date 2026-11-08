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
  context.facilis = {
    db: state.db,
    defaultTenantId: readDefaultTenantId(),
    // `ctx.jobs` is required by the handler contract: attach it whenever the runtime
    // booted. Without it the wrapper substitutes a `job_unavailable` fallback (D-107).
    ...(state.jobs === null ? {} : { jobs: state.jobs.api }),
    // Same contract for `ctx.storage` (D-053): missing runtime => route-level fallback.
    ...(state.storage === null ? {} : { storage: state.storage }),
  };
};

export default handler;
