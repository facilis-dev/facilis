// The global Ctrl/Cmd+Shift+L binding (issue #204). The handler ignores the chord while the
// caret is in an input, Monaco or the terminal, never touches Ctrl/Cmd+P or Ctrl/Cmd+K, and
// opens the picker without changing the active lens. Closing is the picker's own Escape.

import { useCallback, useEffect, useState } from "react";
import { isLensChordBlocked, isLensPickerChord, type LensFocusTarget } from "./graph-lens-commands";

export interface GraphLensShortcuts {
  readonly pickerOpen: boolean;
  readonly closePicker: () => void;
}

export function useGraphLensShortcuts(): GraphLensShortcuts {
  const [pickerOpen, setPickerOpen] = useState(false);
  const closePicker = useCallback(() => setPickerOpen(false), []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (pickerOpen || event.defaultPrevented || !isLensPickerChord(event)) return;
      if (isLensChordBlocked(event.target as LensFocusTarget | null)) return;
      event.preventDefault();
      setPickerOpen(true);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [pickerOpen]);
  return { pickerOpen, closePicker };
}
