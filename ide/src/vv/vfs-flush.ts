// Durability for the kernel's OPFS write-behind mirror (SPEC 13 risk 9).
//
// The VFS mirrors to OPFS a few milliseconds behind every write, and `KernelBridge`
// already posts `fs-flush` on `pagehide`. That is not enough: a tab can be hidden,
// frozen or discarded without a pagehide, and the user expectation is that the last
// edit is still there when the tab is reopened. Flushing on `visibilitychange` costs
// one message (the queue is empty most of the time) and is the one place
// `opfs-persistence.flush()` promises durability.
//
// The Studio has no other place to hook this: the controller is baseline-pinned by
// the file-length ratchet, so the wiring lives in a module and IdeProvider installs it.

import type { KernelBridge } from "./kernel";

export function installVfsFlush(bridge: KernelBridge): () => void {
  const flush = () => bridge.post("fs-flush");
  const onVisibilityChange = () => flush();
  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("pagehide", flush);
  return () => {
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("pagehide", flush);
  };
}
