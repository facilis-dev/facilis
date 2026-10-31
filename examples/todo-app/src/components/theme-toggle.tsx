import { Button } from "@facilis/ui";
import { t } from "@facilis/core/i18n";
import { useTheme } from "../lib/theme.ts";

/**
 * Flips the complete variable set theme.css applies. The visible text names the current theme;
 * the accessible name states the action, so the control is unambiguous either way.
 */
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const action = theme === "dark" ? t("theme.to_light") : t("theme.to_dark");

  return (
    <Button variant="ghost" size="sm" aria-label={action} title={action} onClick={toggle}>
      {theme === "dark" ? t("theme.light") : t("theme.dark")}
    </Button>
  );
}
