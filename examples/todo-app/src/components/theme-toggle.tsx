import { t } from "@facilis/core/i18n";
import { IconMoon, IconSun } from "./icons.tsx";
import { Button } from "./ui/button.tsx";
import { useTheme } from "../lib/theme.ts";

/**
 * Flips the complete variable set the stylesheet applies. The icon previews the theme the
 * click switches to; the accessible name states the action, so the control is unambiguous.
 */
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const action = theme === "dark" ? t("theme.to_light") : t("theme.to_dark");

  return (
    <Button variant="ghost" size="sm" aria-label={action} title={action} onClick={toggle}>
      {theme === "dark" ? <IconSun /> : <IconMoon />}
      <span>{theme === "dark" ? t("theme.light") : t("theme.dark")}</span>
    </Button>
  );
}
