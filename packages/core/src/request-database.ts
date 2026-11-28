import type { FacilisDb } from "@facilis.dev/db";

/**
 * The request database, held outside the public event (D-226 decisions 3/4).
 *
 * The context middleware used to publish the root Drizzle client on
 * `event.context.facilis.db`, which made every raw Nitro handler a database client with the
 * connecting identity (a superuser in dev, facilis_app plus SET ROLE in production). The
 * wrapper now receives the client through this module-private WeakMap instead: the event
 * object cannot show it to a handler, and a project cannot attach one by writing context.
 *
 * The map is keyed by the request event object. Middleware attaches once before routes run;
 * the wrapper and the request transaction read it. Nothing removes it during a request
 * because a raw route's `ctx.rawDb` closure is created from the same value.
 */
const requestDatabases = new WeakMap<object, FacilisDb>();

/** Called by the Nitro context middleware after the db booted. */
export function attachRequestDatabase(event: object, db: FacilisDb): void {
  requestDatabases.set(event, db);
}

/** Called on teardown (or by a test) so a recycled event object cannot keep a client. */
export function detachRequestDatabase(event: object): void {
  requestDatabases.delete(event);
}

/** The wrapper's only way to obtain the root client; undefined means db_unavailable. */
export function requestDatabase(event: object): FacilisDb | undefined {
  return requestDatabases.get(event);
}
