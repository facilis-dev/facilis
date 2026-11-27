// Italian form of en-security-surface.ts (D-226, #235); spread into `it` in it.ts.
import type { MessageKey } from "./index";

export const securitySurfaceIt: Partial<Record<MessageKey, string>> = {
  "projectGraph.surface.security.badge":
    "{declared} dichiarate · {undeclared} non dichiarate · {unknown} sconosciute",
  "projectGraph.surface.security.tooltip":
    "Superficie dichiarata (D-226): {standard} standard, {declared} dichiarate, {undeclared} non dichiarate, {unknown} sconosciute. Scarica security-surface.json per la revisione di sicurezza.",
  "projectGraph.surface.security.download": "Scarica security-surface.json",
  "projectGraph.surface.security.downloadFailed":
    "Impossibile scaricare la superficie di sicurezza: {error}",
};
