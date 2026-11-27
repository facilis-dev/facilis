import { useEffect, useLayoutEffect, useRef } from "react";
import Loader from "~icons/lucide/loader-circle";
import { t } from "@/i18n";
import { restoreWorkspaceFocus } from "./home-focus";
import { useBlockingLayer } from "./use-blocking-layer";
import { useIde } from "./useIde";

// Full-screen blocking overlay shown while a #share= link bootstraps into a new
// project. Rendered over the (kept-mounted) workspace — not Home — so the user
// gets a clear, prominent signal and can't click into the IDE mid-bootstrap.
export function ShareLoadingOverlay() {
  const { snap } = useIde();
  const rootRef = useRef<HTMLDivElement>(null);
  // The cover registers on the shared layer stack and holds focus, so Tab cannot reach the
  // workspace behind the spinner and every global chord is dropped (#217).
  useBlockingLayer("share-loading", snap.shareLoading);
  useLayoutEffect(() => {
    rootRef.current?.focus();
  }, []);
  // A #share= link has no opener: Home's title-bar brand is the defined return target (#212).
  useEffect(() => () => restoreWorkspaceFocus(null), []);
  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      data-blocking-overlay=""
      className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm outline-none"
    >
      <div className="flex flex-col items-center gap-4 rounded-xl border bg-card px-12 py-10 shadow-lg">
        <Loader className="size-10 animate-spin text-primary" />
        <div className="text-center" role="status">
          <div className="text-base font-medium">{t("overlays.share.opening")}</div>
          <div className="mt-1 text-sm text-muted-foreground">{snap.shareMessage}</div>
        </div>
      </div>
    </div>
  );
}
