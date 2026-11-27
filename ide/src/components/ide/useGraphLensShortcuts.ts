// The graph-lens picker's open state (issues #204/#223). The chord is a registry entry
// (shortcuts.ts, id "graph-lens") and AppShell dispatches it; that entry's deferTo keeps
// Ctrl/Cmd+Shift+L with the editor and the terminal, where the binding is their own.
import { useCallback, useState } from "react";

export interface GraphLensShortcuts {
  readonly pickerOpen: boolean;
  readonly openPicker: () => void;
  readonly closePicker: () => void;
}

export function useGraphLensShortcuts(): GraphLensShortcuts {
  const [pickerOpen, setPickerOpen] = useState(false);
  const openPicker = useCallback(() => setPickerOpen(true), []);
  const closePicker = useCallback(() => setPickerOpen(false), []);
  return { pickerOpen, openPicker, closePicker };
}
