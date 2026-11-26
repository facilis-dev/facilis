// The compact IDE shell's breakpoint, in one place.
//
// 1024px is Tailwind's `lg`: the narrow layout starts exactly where the `lg:`
// utilities stop applying, so the JS branch and the CSS cannot disagree. Issue #195
// was filed at 390px, and a portrait tablet has the same problem one pane wider, so
// the whole sub-`lg` range gets the single-column shell rather than a third layout.
import { useSyncExternalStore } from "react";

export const NARROW_SHELL_QUERY = "(max-width: 1023px)";

/** Null where matchMedia does not exist (a test environment without a window). */
function mediaQuery(): MediaQueryList | null {
  if (typeof matchMedia === "undefined") return null;
  return matchMedia(NARROW_SHELL_QUERY);
}

function subscribe(onChange: () => void): () => void {
  const query = mediaQuery();
  if (!query) return () => {};
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** True below 1024px. Re-renders when the window crosses the breakpoint. */
export function useNarrowShell(): boolean {
  return useSyncExternalStore(subscribe, () => mediaQuery()?.matches ?? false);
}
