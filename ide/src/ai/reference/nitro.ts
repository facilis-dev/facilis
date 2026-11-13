import type { FrameworkModule } from "../framework-reference";

/**
 * `@facilis.dev/nitro` — the Vite plugin, its Nitro module and the route-facing helpers
 * (SPEC §5.6, §6.9). vite.config.ts mounts facilis(); generated routes never configure Nitro
 * and never write a nitro.config.ts (D-034).
 */
export const NITRO_MODULE: FrameworkModule = {
  id: "nitro",
  package: "@facilis.dev/nitro",
  summary:
    "The facilis() Vite plugin + Nitro module, framework route constants, OpenAPI facade, upload/download route helpers and session cookies.",
  entries: [
    {
      name: "facilis",
      kind: "function",
      signature: "facilis(): FacilisPlugins",
      summary:
        "The Vite plugin: vite.config.ts uses plugins: [facilis()]. It mounts the Nitro module, delivers the project's Nitro options and owns the /_openapi.json route-metadata pass.",
      example:
        'import { facilis } from "@facilis.dev/nitro/vite";\nexport default { plugins: [facilis()] };',
    },
    {
      name: "createFacilisNitroModule",
      kind: "function",
      signature: "createFacilisNitroModule(): NitroModule",
      summary:
        "Builds the Nitro module (name 'facilis'): registers the ~ alias, the #facilis/* virtual modules, the framework runtime handlers and the native OpenAPI relocation.",
    },
    {
      name: "MANIFEST_ROUTE",
      kind: "constant",
      signature: 'MANIFEST_ROUTE = "/__facilis/manifest"',
      summary:
        "Framework route constants, shared by the module and the runtime: /_openapi.json, /__facilis/manifest (+ /revision, /health) and the dev-only /__facilis/dev/* endpoints.",
    },
    {
      name: "VIRTUAL_DB_SCHEMA_ID",
      kind: "constant",
      signature: 'VIRTUAL_DB_SCHEMA_ID = "#facilis/db-schema"',
      summary:
        "Virtual module ids the Nitro module provides: #facilis/config, #facilis/db-schema, #facilis/db-views, #facilis/jobs, #facilis/workflows, #facilis/openapi-meta.",
    },
    {
      name: "storeUpload",
      kind: "function",
      signature: "storeUpload(input: StoreUploadInput): Promise<StoredFile | Response>",
      summary:
        "Upload-route helper: rejects over-limit files, streams the multipart file into content-addressed storage and inserts the facilis_files row; the route inserts the link row.",
    },
    {
      name: "sendStoredFile",
      kind: "function",
      signature: "sendStoredFile(input: SendStoredFileInput): Promise<Response>",
      summary:
        "Token-only download-route helper: verifies the signed download token, loads the metadata row under the request's policy scope and streams the blob (or redirects to a presigned URL).",
    },
    {
      name: "setSessionCookie",
      kind: "function",
      signature:
        "setSessionCookie(event: FacilisHandlerEvent, sessionId: string, options: SessionCookieOptions): void",
      summary:
        "Sets the httpOnly facilis_session cookie (SameSite=Lax, Secure by default in production) on the current request without importing h3 in the route.",
    },
    {
      name: "clearSessionCookie",
      kind: "function",
      signature: "clearSessionCookie(event: FacilisHandlerEvent): void",
      summary:
        "Expires the facilis_session cookie; call it from the logout route after destroySession.",
    },
    {
      name: "sessionIdFromRequest",
      kind: "function",
      signature: "sessionIdFromRequest(event: FacilisHandlerEvent): string | null",
      summary:
        "Reads the raw session id from the request cookie; null when the request carries no session.",
    },
    {
      name: "mergeOpenApiMetadata",
      kind: "function",
      signature:
        "mergeOpenApiMetadata(spec: OpenApiDocument, metadata: RouteMetadataMap): OpenApiDocument",
      summary:
        "Merges the AST pass's route metadata (permission, dbTables, description) into Nitro's generated spec for /_openapi.json; unreadable fields become x-facilis-warning.",
    },
  ],
};
