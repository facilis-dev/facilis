// The observability link-out strings (D-203 §6, issue #140), spread into `en` in en.ts.
//
// Kept in their own module because the catalogue sits near the 300-line limit — same rule as
// en-release-preview.ts. Keys stay flat; the link-out has no dynamic values.
export const telemetryLinkoutEn = {
  "telemetry.linkout.label": "Observability",
  "telemetry.linkout.tooltip": "Open the operator observability dashboard in a new tab",
} as const;
