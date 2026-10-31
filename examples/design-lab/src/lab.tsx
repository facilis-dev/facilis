import { useEffect, useState, type ReactNode } from "react";
import { Toaster } from "@facilis/ui";
import { IconLogo, IconMoon, IconSun } from "./icons.tsx";
import {
  DIRECTIONS,
  SCREENS,
  applyPreferences,
  readPreferences,
  writePreferences,
  type Direction,
  type ScreenId,
} from "./preferences.ts";
import { AuthScreen } from "./screens/auth.tsx";
import { DashboardScreen } from "./screens/dashboard.tsx";
import { DetailScreen } from "./screens/detail.tsx";
import { SettingsScreen } from "./screens/settings.tsx";

type DirectionMeta = {
  readonly key: string;
  readonly name: string;
  readonly trait: string;
  readonly note: string;
};

/** One-line trait per direction: enough for the owner to map taste to a choice. */
const DIRECTION_META: Record<Direction, DirectionMeta> = {
  a: {
    key: "A",
    name: "Institutional",
    trait: "data-first",
    note: "dense tables, green signal accent",
  },
  b: {
    key: "B",
    name: "Platform",
    trait: "brand-forward",
    note: "violet brand gradient, light and dark",
  },
  c: {
    key: "C",
    name: "Premium",
    trait: "warm editorial",
    note: "champagne finish, generous spacing",
  },
};

const SCREEN_META: Record<ScreenId, { readonly label: string; readonly render: () => ReactNode }> =
  {
    auth: { label: "Auth", render: () => <AuthScreen /> },
    dashboard: { label: "Dashboard", render: () => <DashboardScreen /> },
    detail: { label: "Detail / Form", render: () => <DetailScreen /> },
    settings: { label: "Settings", render: () => <SettingsScreen /> },
  };

/**
 * Lab shell: direction, screen and theme selectors that persist in localStorage, applying
 * data-direction / data-theme to <html> where directions.css expects them. The screens below
 * are the product, not the lab — the chrome is deliberately quiet.
 */
export function Lab() {
  const [preferences, setPreferences] = useState(readPreferences);

  useEffect(() => {
    applyPreferences(preferences);
    writePreferences(preferences);
  }, [preferences]);

  const direction = DIRECTION_META[preferences.direction];
  const screen = SCREEN_META[preferences.screen];
  const nextTheme = preferences.theme === "dark" ? "light" : "dark";

  return (
    <div className="lab-root">
      <header className="lab-bar">
        <div className="lab-bar__brand">
          <span className="lab-bar__mark">
            <IconLogo size={16} />
          </span>
          <span className="lab-bar__title">Facilis</span>
          <span className="lab-bar__separator" />
          <span className="lab-bar__sub">design lab</span>
        </div>

        <div className="lab-bar__group">
          <p className="lab-bar__label">Direction</p>
          <div className="lab-choice" role="group" aria-label="Visual direction">
            {DIRECTIONS.map((id) => (
              <button
                key={id}
                type="button"
                className="lab-choice__btn"
                aria-pressed={preferences.direction === id}
                title={DIRECTION_META[id].name + " — " + DIRECTION_META[id].trait}
                onClick={() => setPreferences((current) => ({ ...current, direction: id }))}
              >
                <span className="lab-choice__key">{DIRECTION_META[id].key}</span>
                <span className="lab-choice__name">{DIRECTION_META[id].name}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="lab-bar__group">
          <p className="lab-bar__label">Screen</p>
          <div className="lab-choice" role="group" aria-label="Reference screen">
            {SCREENS.map((id) => (
              <button
                key={id}
                type="button"
                className="lab-choice__btn"
                aria-pressed={preferences.screen === id}
                onClick={() => setPreferences((current) => ({ ...current, screen: id }))}
              >
                {SCREEN_META[id].label}
              </button>
            ))}
          </div>
        </div>

        <span className="lab-bar__spacer" />

        <button
          type="button"
          className="lab-theme"
          aria-label={"Switch to " + nextTheme + " theme"}
          onClick={() =>
            setPreferences((current) => ({
              ...current,
              theme: current.theme === "dark" ? "light" : "dark",
            }))
          }
        >
          {preferences.theme === "dark" ? <IconSun /> : <IconMoon />}
          {nextTheme === "dark" ? "Dark" : "Light"}
        </button>

        <div className="lab-bar__meta">
          <p className="lab-bar__ref">
            {direction.key} — {direction.name} · {direction.trait} · {direction.note}
          </p>
          {preferences.direction === "a" ? <span className="lab-rec">Recommended</span> : null}
        </div>
      </header>

      <main className="lab-stage">
        <div className="lab-viewport" data-screen={preferences.screen}>
          {screen.render()}
        </div>
      </main>

      <Toaster />
    </div>
  );
}
