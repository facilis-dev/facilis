// Which page kind a miniature draws (D-178).
//
// D-176 drew every page as the app shell (rail, optional top bar, content), because that is what
// its intrinsics prove. The owner saw at once what that misses: login and register are not app
// pages, they are a split brand panel beside a centred card. The analyzer already resolves the
// route table, and that is the semantic fact that tells the page kinds apart; component names are
// the fallback for a page whose route the analysis could not resolve. Pure, no I/O.

import type { PagePreview } from "@facilis.dev/analyze";

export type SketchLayout = "app" | "auth" | "plain";

/** URL paths of the screens a framework's auth flow mounts (login, recovery, verification). */
const AUTH_ROUTE =
  /(?:^|\/)(?:auth|login|log-in|register|sign-?in|sign-?up|forgot-password|reset-password|verify-email)(?:\/|$)/i;

/** Components only an auth screen renders; the template names its card after the role. */
const AUTH_COMPONENT =
  /(?:login|register|sign-?in|sign-?up|forgot|reset-password|auth(?:layout|shell|card|page))/i;

function isAuthPage(preview: PagePreview): boolean {
  if (preview.routePaths.some((path) => AUTH_ROUTE.test(path))) return true;
  return preview.nodes.some((node) => node.kind === "component" && AUTH_COMPONENT.test(node.name));
}

export function classifyPageLayout(
  preview: PagePreview,
  shell: { readonly header: boolean; readonly rail: boolean },
): SketchLayout {
  if (isAuthPage(preview)) return "auth";
  return shell.header || shell.rail ? "app" : "plain";
}
