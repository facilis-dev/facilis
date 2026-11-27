// One breakpoint row, split out of DebugPanel.tsx (pinned at 375 lines by the file-length
// ratchet) so the reveal-on-focus remove control can be rendered statically in tests
// (issue #215). ide/ ships no jsdom: the markup is the observable surface.
import Circle from "~icons/lucide/circle";
import X from "~icons/lucide/x";
import { t } from "@/i18n";

const baseName = (path: string) => path.split("/").pop() || path;

export function DebugBreakpointRow({
  path,
  line,
  onOpen,
  onRemove,
}: {
  path: string;
  line: number;
  onOpen: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="group flex items-center gap-2 px-3 py-0.5 text-xs hover:bg-accent">
      <Circle className="size-2.5 shrink-0 fill-destructive text-destructive" />
      <button
        type="button"
        className="min-w-0 flex-1 truncate text-left hover:underline"
        onClick={onOpen}
        title={`${path}:${line}`}
      >
        {baseName(path)}:{line}
      </button>
      {/* Opacity, never display:none: the remove control stays in the tab order and is
          revealed by the row's focus-within, not only by the pointer (issue #215). */}
      <button
        type="button"
        className="opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
        onClick={onRemove}
        title={t("debug.removeBreakpoint")}
        aria-label={t("debug.removeBreakpoint")}
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
