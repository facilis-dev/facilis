// Method badge classes shared by the API Flow canvas and its inspector. Role tokens only
// (D-043/D-044), so a theme block flips them.
import type { ApiMethod } from "@/facilis/api-flow-client";

export const METHOD_BADGES: Record<ApiMethod, string> = {
  GET: "border-info/40 bg-info/10 text-info",
  POST: "border-success/40 bg-success/10 text-success",
  PUT: "border-warning/40 bg-warning/10 text-warning",
  PATCH: "border-primary/40 bg-primary/10 text-primary",
  DELETE: "border-destructive/40 bg-destructive/10 text-destructive",
};
