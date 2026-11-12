import { useId } from "react";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";
import { FACILIS_TEMPLATES, type TemplateKey } from "@/facilis/templates";

/**
 * The template radio grid shared by NewProjectDialog and ScaffoldTemplateDialog. Both
 * ask the same question of the same registry, so the markup lives here instead of
 * drifting between the two dialogs.
 */
export function TemplatePicker({
  value,
  onChange,
}: {
  value: TemplateKey;
  onChange: (key: TemplateKey) => void;
}) {
  // Radio groups are matched by `name`, and two dialogs can be mounted at once (Home
  // overlays the kept-mounted IDE), so the group id must be unique per instance.
  const group = useId();
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1 text-xs font-medium text-muted-foreground">
        {t("create.template")}
      </legend>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {FACILIS_TEMPLATES.map((option) => {
          const selected = value === option.key;
          return (
            <label
              key={option.key}
              className={cn(
                "flex cursor-pointer flex-col gap-0.5 rounded-lg border p-3 text-left transition-colors",
                selected
                  ? "border-primary bg-primary/5"
                  : "hover:border-primary/40 hover:bg-accent/40",
              )}
            >
              <input
                type="radio"
                name={group}
                className="sr-only"
                checked={selected}
                onChange={() => onChange(option.key)}
              />
              <span className="text-sm font-medium">{t(option.labelKey)}</span>
              <span className="text-xs text-muted-foreground">{t(option.descriptionKey)}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
