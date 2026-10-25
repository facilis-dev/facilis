// Navigation of the preview iframe.
//
// The preview is served by the kernel's Service Worker under /preview/<port>/. If a
// fresh iframe navigates before that worker is ACTIVE (or before it claims clients on a
// cold page load), the request escapes to the dev server, whose SPA fallback answers with
// the studio's own index.html — the preview then shows a recursive copy of the IDE, which
// in a sandbox is indistinguishable from "the project did not start". Wait for the proxy
// worker before navigating; fall back to the plain navigation if there is none.

import type { MutableRefObject } from "react";

export async function navigatePreviewFrame(
  el: HTMLIFrameElement | null,
  src: string,
  lastSrc: MutableRefObject<string | null>,
): Promise<void> {
  if (!el || lastSrc.current === src) return;
  lastSrc.current = src;
  if ("serviceWorker" in navigator) {
    await Promise.race([
      navigator.serviceWorker.ready.catch(() => null),
      new Promise((resolve) => setTimeout(resolve, 4000)),
    ]);
  }
  el.src = src;
}
