// The status-bar readout for Tab-moves-focus (issue #210). Monaco draws no chrome for the mode
// and its own alert fires once in English, so the IDE owns the visible chip — and the same words
// sit in a live region, because a chip appearing is not something a screen reader can see. The
// markup is asserted statically: ide/ ships no jsdom, so real focus movement stays a smoke step.
import { useSyncExternalStore } from "react";
import Keyboard from "~icons/lucide/keyboard";
import { tabFocusMode, tabFocusModeLabel } from "@/vv/tab-focus-mode";

export function TabFocusModeStatus() {
  // The snapshot doubles as the server one: the markup test renders this statically, and the
  // store is module state either way.
  const on = useSyncExternalStore(
    tabFocusMode.subscribe,
    tabFocusMode.getSnapshot,
    tabFocusMode.getSnapshot,
  );
  return (
    <>
      {on && (
        <span className="flex h-6 items-center gap-1 whitespace-nowrap px-2">
          <Keyboard className="size-3.5" />
          {tabFocusModeLabel(true)}
        </span>
      )}
      <span role="status" className="sr-only">
        {tabFocusModeLabel(on)}
      </span>
    </>
  );
}
