/**
 * @facilis/core — framework contract types and helpers.
 *
 * Phase 0 skeleton: the public shapes used by generated projects are declared here.
 * Runtime validation of the auth config (permission/role cross-checks, spec §8.4.1)
 * lands with the real implementation.
 */

export interface FacilisAuthConfig {
  permissions: readonly string[];
  roles: Readonly<Record<string, readonly string[]>>;
  defaultRole: string;
  sessionDurationMs?: number;
}

export interface FacilisDbConfig {
  url?: string;
  tenantColumns?: readonly string[];
  ownerColumns?: readonly string[];
}

export interface FacilisConfig {
  auth: FacilisAuthConfig;
  db?: FacilisDbConfig;
  release?: {
    ref?: string;
  };
}

export function defineConfig(config: FacilisConfig): FacilisConfig {
  return config;
}
