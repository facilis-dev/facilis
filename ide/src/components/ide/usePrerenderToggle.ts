// The prerender toggle's side effects (issue #84): one studio write through the kernel VFS,
// then a graph refresh without a reload. The write invalidates the analysis source cache, so
// the panel's next loadProjectAnalysis reads the new declaration and every chip, the route
// satellite and the canvas reflect it. A failed write is a toast, never a silent no-op.

import { toast } from "sonner";
import { t } from "@/i18n";
import type { IdeController } from "@/vv/controller";
import { writePrerenderDeclaration } from "@/facilis/prerender-write";

export function usePrerenderToggle(
  controller: IdeController,
  root: string | null,
  refresh: () => void,
): (path: string, enabled: boolean) => Promise<boolean> {
  return async (path, enabled) => {
    if (root === null) return false;
    const result = await writePrerenderDeclaration(controller, root, path, enabled);
    if (!result.ok) {
      toast.error(t("projectGraph.prerender.writeFailed", { error: result.error }));
      return false;
    }
    refresh();
    return true;
  };
}
