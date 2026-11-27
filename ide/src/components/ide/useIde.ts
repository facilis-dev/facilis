import { createContext, useContext, useSyncExternalStore } from "react";
import { IdeController, type IdeSnapshot } from "@/vv/controller";

// One kernel worker per page → one controller. A module-level singleton keeps
// React StrictMode's double-mount from spawning a second kernel worker.
let singleton: IdeController | null = null;
export function getController(): IdeController {
  return (singleton ??= new IdeController());
}

export const IdeContext = createContext<IdeController | null>(null);

export function useController(): IdeController {
  const c = useContext(IdeContext);
  if (!c) throw new Error("useController must be used within <IdeProvider>");
  return c;
}

/** Subscribe to the controller's immutable UI snapshot. */
export function useIde(): { c: IdeController; snap: IdeSnapshot } {
  const c = useController();
  // The third argument is the server snapshot: a static render of a surface (Home's markup
  // test) reads the current snapshot instead of throwing. The app itself is client-only.
  const snap = useSyncExternalStore(c.subscribe, c.getSnapshot, c.getSnapshot);
  return { c, snap };
}
