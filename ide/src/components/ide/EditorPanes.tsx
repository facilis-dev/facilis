// The editor-area panes that are not Monaco text: an image preview, a directory notice
// and the Source Control diff tab. Split from EditorGroup.tsx to stay under the
// file-length ratchet and so the diff pane can be replaced without touching the tab strip.

import { useCallback, useState } from "react";
import { useIde } from "./useIde";

const baseName = (rel: string) => rel.split("/").pop() ?? rel;

// Image preview pane (raster + svg). The object URL is created/owned by the
// controller (revoked when the tab closes), so we just render it.
export function ImageView({ abs }: { abs: string }) {
  const { c } = useIde();
  const url = c.imageUrlFor(abs);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 overflow-auto bg-editor p-6">
      <div
        className="max-h-full max-w-full"
        style={{
          backgroundImage:
            "linear-gradient(45deg,var(--checker) 25%,transparent 25%),linear-gradient(-45deg,var(--checker) 25%,transparent 25%),linear-gradient(45deg,transparent 75%,var(--checker) 75%),linear-gradient(-45deg,transparent 75%,var(--checker) 75%)",
          backgroundSize: "16px 16px",
          backgroundPosition: "0 0,0 8px,8px -8px,-8px 0",
        }}
      >
        {url ? (
          <img
            src={url}
            alt={baseName(abs)}
            className="max-h-[calc(100vh-12rem)] max-w-full object-contain"
            onLoad={(e) =>
              setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
            }
          />
        ) : (
          <div className="p-8 text-sm text-muted-foreground">Loading image…</div>
        )}
      </div>
      <div className="text-xs text-muted-foreground">
        {baseName(abs)}
        {dims ? ` · ${dims.w}×${dims.h}` : ""}
      </div>
    </div>
  );
}

// Shown when a directory is opened in the editor (dragged onto Monaco).
export function DirectoryView() {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-editor p-6 text-center text-sm text-muted-foreground">
      The file is not displayed in the text editor because it is a directory.
    </div>
  );
}

// Source Control diff tab: a read-only Monaco diff editor (HEAD ↔ working tree).
// Keyed by tab id in the parent, so it remounts per diff tab and the controller
// rebinds fresh original/modified models.
export function DiffView({ id }: { id: string }) {
  const { c } = useIde();
  const ref = useCallback(
    (el: HTMLDivElement | null) => {
      if (el) void c.mountDiffEditor(el, id);
    },
    [c, id],
  );
  return <div ref={ref} className="absolute inset-0" />;
}
