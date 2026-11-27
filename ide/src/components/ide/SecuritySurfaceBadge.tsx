// The connected declared-surface badge for the project-graph header (D-226, #235): it reads
// GET /__facilis/security-surface.json through the preview proxy, so the counts come from the
// same facts the release artifact serializes and the graph cannot disagree with the review.
//
// The route is dev-only: anything unavailable or unparsable hides the badge instead of failing,
// so a production preview keeps a usable graph with no framework dev server behind it.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { t } from "@/i18n";
import type { KernelBridge } from "@/vv/kernel";
import type { IdeSnapshot } from "@/vv/controller";
import { previewSrcFor } from "@/vv/preview-url";
import {
  downloadSecuritySurface,
  fetchSecuritySurface,
  type SecuritySurfaceDocument,
} from "@/facilis/security-surface-client";
import { SecuritySurfaceBadgeView } from "./SecuritySurfaceBadgeView";
import { useIde } from "./useIde";

/** The preview proxy base the framework endpoints answer under, or null when nothing runs. */
export function activePreviewBase(snapshot: IdeSnapshot, bridge: KernelBridge): string | null {
  const tab =
    snapshot.previewTabs.find((entry) => entry.id === snapshot.activePreviewId) ??
    snapshot.previewTabs.find((entry) => entry.port !== null);
  if (tab === undefined || tab.port === null) return null;
  return previewSrcFor(bridge, tab);
}

export function SecuritySurfaceBadge() {
  const { c, snap } = useIde();
  const [document, setDocument] = useState<SecuritySurfaceDocument | null>(null);
  const [busy, setBusy] = useState(false);
  const base = activePreviewBase(snap, c.bridge);

  useEffect(() => {
    if (base === null) {
      setDocument(null);
      return;
    }
    const abort = new AbortController();
    let live = true;
    void fetchSecuritySurface(base, { signal: abort.signal }).then((result) => {
      if (live) setDocument(result.ok ? result.document : null);
    });
    return () => {
      live = false;
      abort.abort();
    };
  }, [base]);

  const onDownload = (): void => {
    if (base === null || busy) return;
    setBusy(true);
    void downloadSecuritySurface(base).then((result) => {
      setBusy(false);
      if (!result.ok) {
        toast.error(t("projectGraph.surface.security.downloadFailed", { error: result.error }));
      }
    });
  };

  return (
    <SecuritySurfaceBadgeView
      summary={document?.summary ?? null}
      busy={busy}
      onDownload={onDownload}
    />
  );
}
