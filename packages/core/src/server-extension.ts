/**
 * `defineServerExtension` (D-226 decision 4): the only way project server code outside a
 * route is loaded. `server/plugins`, `server/middleware`, `server/modules` and
 * `server/tasks` are otherwise not mounted, so an undeclared extension cannot run during
 * boot — where no route guard could ever see it.
 */
import { assertSurfaceReason, brandServerExtension } from "./surface.ts";

export type ServerExtensionKind = "plugin" | "middleware" | "module" | "task";

export interface ServerExtensionConfig {
  /** Why the extension exists; shown in the security export. */
  readonly reason: string;
  readonly kind?: ServerExtensionKind;
  /** Provenance written by the IDE after the user confirmed an AI-originated declaration. */
  readonly confirmed?: { readonly at: string; readonly by: string };
}

/**
 * Brands and returns the Nitro plugin/middleware/module/task as written. The wrapper adds
 * no runtime behavior: the value must stay the exact export Nitro expects.
 */
export function defineServerExtension<T extends object>(
  config: ServerExtensionConfig,
  extension: T,
): T {
  assertSurfaceReason(config.reason, "server-extension");
  if (config.kind !== undefined && !EXTENSION_KINDS.has(config.kind)) {
    throw new Error("surface_declaration_invalid: unknown server-extension kind.");
  }
  return brandServerExtension(extension);
}

const EXTENSION_KINDS: ReadonlySet<string> = new Set<ServerExtensionKind>([
  "plugin",
  "middleware",
  "module",
  "task",
]);
