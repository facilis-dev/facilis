import { useEffect, useRef } from "react";
import { revealRow } from "./explorer-tree-layout";

// Inline rename / create field. The initial selection must happen exactly once
// (on mount) — doing it in an inline `ref` re-selects the whole value on every
// keystroke's re-render, which makes typed characters replace the selection so
// only the last character survives.
export function ExplorerNameInput({
  value,
  onChange,
  commit,
  cancel,
  depth,
}: {
  value: string;
  onChange: (v: string) => void;
  commit: () => void;
  cancel: () => void;
  depth: number;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // `preventScroll`, then reveal by hand: the browser's own focus scroll would put
    // this input flush against the top of the scrollport, i.e. behind the parked
    // ancestor rows, which is where a new file's name field used to disappear to.
    //
    // Deliberately `nearest`, unlike the active-file reveal: this input has just been
    // spawned next to a row the user clicked, so it is already where they are looking.
    // The job is only to get it out from behind the sticky stack, and moving the list
    // the minimum amount to do that is less disorienting than yanking it to the middle
    // under a pointer that has not moved yet.
    el.focus({ preventScroll: true });
    revealRow(el, depth, "nearest");
    const dot = el.value.indexOf(".");
    el.setSelectionRange(0, dot > 0 ? dot : el.value.length);
    // Run once on mount only — never re-select on subsequent renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <input
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") commit();
        else if (e.key === "Escape") cancel();
      }}
      onBlur={commit}
      className="min-w-0 flex-1 rounded-sm bg-background px-1 text-sm text-foreground outline outline-1 outline-primary"
    />
  );
}
