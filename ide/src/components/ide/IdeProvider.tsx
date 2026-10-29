import { useEffect, type ReactNode } from "react";
import { installFacilisDevHandle } from "@/facilis/dev-handle";
import { installProjectTabs } from "@/vv/project-tabs";
import { installVfsFlush } from "@/vv/vfs-flush";
import { IdeContext, getController } from "./useIde";

export function IdeProvider({ children }: { children: ReactNode }) {
  const controller = getController();
  useEffect(() => {
    controller.start();
    const disposeFlush = installVfsFlush(controller.bridge);
    // One project per browser tab: ?project= bootstrap + the cross-tab claim guard.
    const disposeProjectTabs = installProjectTabs(controller);
    // Dev-only handles for debugging + headless parity tests.
    if (import.meta.env.DEV) {
      (window as unknown as { __ide: unknown }).__ide = controller;
      installFacilisDevHandle(controller);
    }
    return () => {
      disposeProjectTabs();
      disposeFlush();
    };
  }, [controller]);
  return <IdeContext.Provider value={controller}>{children}</IdeContext.Provider>;
}
