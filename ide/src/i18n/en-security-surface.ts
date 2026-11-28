// The declared-security-surface strings (D-226, #235), spread into `en` in en.ts. The badge,
// its tooltip and the artifact download live in the project graph's header but keep their own
// module: en-project-graph.ts is at the file-length limit.
export const securitySurfaceEn = {
  "projectGraph.surface.security.badge":
    "{declared} declared · {undeclared} undeclared · {unknown} unknown",
  "projectGraph.surface.security.tooltip":
    "Declared surface (D-226): {standard} standard, {declared} declared, {undeclared} undeclared, {unknown} unknown capabilities. Download security-surface.json for the security review.",
  "projectGraph.surface.security.download": "Download security-surface.json",
  "projectGraph.surface.security.downloadFailed":
    "Could not download the security surface: {error}",
} as const;
