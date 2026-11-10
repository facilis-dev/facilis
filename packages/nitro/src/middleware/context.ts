import type { H3Event } from "nitro";
import { getRequestHeader, setResponseHeader } from "nitro/h3";
import {
  acceptRequestId,
  newLogRequestId,
  type FacilisEventContext,
  type FacilisLoggingConfig,
} from "@facilis/core";

import { getBootstrap } from "../runtime/bootstrap.ts";
import { readDefaultTenantId } from "../runtime/tenant.ts";

/**
 * facilis-context middleware (contracts §4.1/§8, D-119).
 *
 * Boots the runtime lazily and exposes event.context.facilis — the db-backed routes, the
 * single-tenant fallback id and the request logging runtime. It also owns the correlation id:
 * an inbound x-request-id is accepted only when it is a safe token, and the resolved id is
 * returned in the response so a client can correlate its request with the server log.
 *
 * When the db is unavailable the facade stays unset, so authorized handlers answer
 * db_unavailable instead of running unscoped; the response still carries the request id.
 */
const REQUEST_ID_HEADER = "x-request-id";
const FORWARDED_FOR_HEADER = "x-forwarded-for";
const USER_AGENT_HEADER = "user-agent";

const handler = async (event: H3Event): Promise<void> => {
  const state = await getBootstrap();
  const context = event.context as FacilisEventContext;

  // Logging is available even when the db never booted; the id is generated in that case so
  // the failed-boot response is still correlatable with the process log.
  const requestId =
    acceptRequestId(getRequestHeader(event, REQUEST_ID_HEADER)) ?? newLogRequestId();
  setResponseHeader(event, REQUEST_ID_HEADER, requestId);

  if (state.db === null) return;

  const client = resolveClient(event, state.loggingConfig);
  context.facilis = {
    db: state.db,
    defaultTenantId: readDefaultTenantId(),
    // ctx.log and the access/error streams are structural for every authorized handler
    // (D-119): attach the runtime and the one id all entries of this request share.
    logging: state.logging,
    requestId,
    ...(client === undefined ? {} : { client }),
    // ctx.jobs is required by the handler contract: attach it whenever the runtime
    // booted. Without it the wrapper substitutes a job_unavailable fallback (D-107).
    ...(state.jobs === null ? {} : { jobs: state.jobs.api }),
    // Same contract for ctx.tasks (D-135): a missing runtime becomes a task_unavailable
    // fallback in the wrapper, never a broken route.
    ...(state.tasks === null ? {} : { tasks: state.tasks.api }),
    // Same contract for ctx.storage (D-053): missing runtime => route-level fallback.
    ...(state.storage === null ? {} : { storage: state.storage }),
  };
};

interface ClientMetadata {
  readonly ip?: string;
  readonly userAgent?: string;
}

/** Client metadata is opt-in: proxy trust and User-Agent collection are deployment decisions. */
function resolveClient(event: H3Event, config: FacilisLoggingConfig): ClientMetadata | undefined {
  const userAgent = config.includeUserAgent
    ? readNonEmptyHeader(event, USER_AGENT_HEADER)
    : undefined;
  const ip = config.trustProxy
    ? firstForwardedFor(readNonEmptyHeader(event, FORWARDED_FOR_HEADER))
    : undefined;
  if (userAgent === undefined && ip === undefined) return undefined;
  return {
    ...(ip === undefined ? {} : { ip }),
    ...(userAgent === undefined ? {} : { userAgent }),
  };
}

/** The first address of x-forwarded-for: the client, before any proxy appends its own. */
export function firstForwardedFor(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const first = value.split(",")[0]?.trim();
  return first === undefined || first.length === 0 ? undefined : first;
}

function readNonEmptyHeader(event: H3Event, name: string): string | undefined {
  const value = getRequestHeader(event, name);
  return value === undefined || value.trim().length === 0 ? undefined : value;
}

export default handler;
