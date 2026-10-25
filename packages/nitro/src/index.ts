/**
 * @facilis/nitro — the Nitro module carried by the `facilis()` Vite plugin.
 *
 * Phase 0 skeleton: the plugin object is typed locally so this package builds without
 * `vite`/`nitro` installed; both are optional peers that generated projects install.
 * The Nitro module hooks and `__facilis` routes arrive in Phase 1.
 */

export interface FacilisVitePlugin {
  readonly name: string;
  readonly enforce?: "pre" | "post";
  readonly apply?: "serve" | "build";
}

export function facilis(): FacilisVitePlugin {
  return { name: "facilis" };
}
