/**
 * @facilis/blocks — manifest-driven UI blocks (Tailwind CSS v4 + shadcn/ui, Base UI).
 *
 * Phase 0 skeleton: manifests and the registry shape are declared here. Components
 * (DataTable, ResourceForm, AuthGuard, …) are added in Phase 3.
 */

export type BlockCategory = "data" | "form" | "layout" | "auth" | "feedback" | "media" | "other";

export interface ApiHint {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  role: "reads" | "writes";
}

export interface BlockManifest {
  name: string;
  version: string;
  category: BlockCategory;
  description: string;
  propsSchema: Readonly<Record<string, unknown>>;
  apiHints?: readonly ApiHint[];
  i18nKeys?: readonly string[];
  requiredPermissions?: readonly string[];
  resourceBound?: boolean;
}

/** Empty until the first blocks land in Phase 3. */
export const blocks: readonly BlockManifest[] = [];
