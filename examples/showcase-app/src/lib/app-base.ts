/**
 * The IDE preview serves a project under "/preview/<port>/", while a standalone dev server
 * serves it at "/". The router basename is derived from the current pathname so links and
 * reloads work in both places.
 */

const PREVIEW_PREFIX = /^\/preview\/\d+(?=\/|$)/;

export function appBasePath(pathname: string = globalThis.location?.pathname ?? "/"): string {
  return PREVIEW_PREFIX.exec(pathname)?.[0] ?? "";
}
