import type { H3Event } from "nitro";
import type { FacilisEventContext } from "@facilis/core";

import { getBootstrap, getSessionHandler } from "../runtime/bootstrap.ts";

/**
 * facilis-session middleware (contracts §4.1).
 *
 * Runs after facilis-context: validates the session cookie on the root client and
 * sets `event.context.auth` (`null` when anonymous). No db means no session.
 */
const handler = async (event: H3Event): Promise<void> => {
  const state = await getBootstrap();
  const context = event.context as FacilisEventContext;
  const sessionHandler = getSessionHandler(state);
  if (sessionHandler === null) {
    context.auth = null;
    return;
  }
  await sessionHandler(event);
};

export default handler;
