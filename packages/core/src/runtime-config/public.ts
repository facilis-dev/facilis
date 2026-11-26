import type { FacilisPublicConfig } from "./schema.ts";

declare global {
  // Injected by the Facilis Vite plugin as a define literal at build time (D-224), the same
  // mechanism the RUM client uses (D-209): no inline script, no CSP surface.
  const __FACILIS_PUBLIC_CONFIG__: FacilisPublicConfig | undefined;
}

const EMPTY: FacilisPublicConfig = Object.freeze({});

/** The only client accessor for baked values; never process.env, never a server key. */
export function publicConfig(): FacilisPublicConfig {
  if (typeof __FACILIS_PUBLIC_CONFIG__ === "undefined") return EMPTY;
  return __FACILIS_PUBLIC_CONFIG__;
}
