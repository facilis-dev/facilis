import { Moon, Sun } from "lucide-react";
import { t } from "../lib/i18n.tsx";
import { useTheme } from "../lib/theme.ts";
import { Button } from "./ui/button.tsx";

/**
 * Flips the complete variable set styles.css applies. The accessible name states the action,
 * so the icon-only control stays unambiguous.
 */
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const action = theme === "dark" ? t("theme.to_light") : t("theme.to_dark");

  return (
    <Button variant="ghost" size="icon" aria-label={action} title={action} onClick={toggle}>
      {theme === "dark" ? <Sun /> : <Moon />}
    </Button>
  );
}
