import { z } from "zod";

/** Request-origin policy for the CSRF gate (SPEC §8); the framework default is same-origin only. */
export interface FacilisSecurityConfig {
  /** Absolute http(s) origins allowed to make unsafe requests besides the request's own. */
  readonly trustedOrigins: readonly string[];
}

/**
 * An allow-list entry must be an exact origin: `Origin` is always `scheme://host[:port]`,
 * so a path or a default-port spelling would silently never match.
 */
function isAbsoluteHttpOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.origin === value;
  } catch {
    return false;
  }
}

/** Shape shared by the authored input and the resolved config (every key defaulted). */
export const securityConfigSchema = z
  .strictObject({
    trustedOrigins: z
      .array(
        z.string().refine(isAbsoluteHttpOrigin, {
          message: "security.trustedOrigins entries must be absolute http(s) origins",
        }),
      )
      .default([]),
  })
  .default(() => ({ trustedOrigins: [] }));

export type FacilisSecurityConfigInput = z.input<typeof securityConfigSchema>;
