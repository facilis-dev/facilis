import type { H3Event } from "nitro";
import { getRequestHeader, getRequestIP, setResponseHeader } from "nitro/h3";
import {
  acceptRequestId,
  attachRequestDatabase,
  newLogRequestId,
  type FacilisEventContext,
  type FacilisLoggingConfig,
} from "@facilis.dev/core";

import { getBootstrap } from "../runtime/bootstrap.ts";
import { runtimeBoolean } from "../runtime/runtime-values.ts";
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

  // The CSRF gate is structural, so it needs a value even when the db never booted: the
  // config default (same-origin only) applies when the project config is unavailable.
  context.security = { trustedOrigins: state.config?.security?.trustedOrigins ?? [] };

  if (state.db === null) return;
  // D-226: the root client never rides on the event. The wrapper reads it from core's
  // private WeakMap; raw handlers cannot see it at all.
  attachRequestDatabase(event, state.db);

  // The wrapper's rate-limit key is resolved for every request, independently of the logging
  // opt-ins (D-152): proxy trust decides whether the address identifies the caller, and leaving
  // it unresolved means "no per-client throttle", never one shared window for every user.
  const trustProxy = runtimeBoolean(state.runtime, "logTrustProxy") === true;
  const client = resolveClient(event, state.loggingConfig, trustProxy);
  const clientAddress = getRequestIP(event, { xForwardedFor: trustProxy });
  context.facilis = {
    defaultTenantId: readDefaultTenantId(state.runtime),
    ...(clientAddress === undefined ? {} : { clientAddress }),
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
    // Same contract for ctx.workflows (D-135): a missing runtime becomes a
    // workflow_unavailable fallback in the wrapper, never a broken route.
    ...(state.workflows === null ? {} : { workflows: state.workflows.api }),
    // Same contract for ctx.storage (D-053): missing runtime => route-level fallback.
    ...(state.storage === null ? {} : { storage: state.storage }),
  };
};

interface ClientMetadata {
  readonly ip?: string;
  readonly userAgent?: string;
}

/** Client metadata is opt-in: proxy trust and User-Agent collection are deployment decisions. */
function resolveClient(
  event: H3Event,
  config: FacilisLoggingConfig,
  trustProxy: boolean,
): ClientMetadata | undefined {
  const userAgent = config.includeUserAgent
    ? readNonEmptyHeader(event, USER_AGENT_HEADER)
    : undefined;
  const ip = trustProxy
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
