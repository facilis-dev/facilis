// A preview tab's close control, split out of PreviewPanel.tsx (near the 300-line limit)
// so the reveal-on-focus state can be rendered statically in tests (issue #215).
import X from "~icons/lucide/x";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";

export function PreviewTabClose({ active, onClose }: { active: boolean; onClose: () => void }) {
  return (
    <button
      type="button"
      title={t("preview.close")}
      aria-label={t("preview.close")}
      className="flex size-4 items-center justify-center rounded hover:bg-accent"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      {/* The active tab always shows the close mark; an inactive one reveals it when the
          tab (or this button) has focus, never only on hover (issue #215). */}
      <X
        className={cn(
          "size-3 transition-opacity",
          active
            ? "opacity-100"
            : "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100",
        )}
      />
    </button>
  );
}
