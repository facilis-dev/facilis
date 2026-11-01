import { useId, useRef, useState, type AriaAttributes, type KeyboardEvent } from "react";
import { cx } from "./class-names.ts";
import { Input } from "./input.tsx";
import { Select } from "./select.tsx";
import { Textarea } from "./textarea.tsx";
import {
  addableLocales,
  addLocale,
  defaultLocaleOf,
  isFilled,
  orderedLocales,
  removeLocale,
  resolveActiveLocale,
  type Translations,
} from "./translations-input-model.ts";
import { nextTabIndex } from "./tab-keys.ts";
import "./translations-input.css";

export type { Translations } from "./translations-input-model.ts";

export type TranslationsInputLabels = {
  addLanguage?: string;
  removeLanguage?: (locale: string) => string;
  emptyTranslation?: string;
  primary?: string;
  languagesLabel?: string;
};

export type TranslationsInputProps = {
  value: Translations;
  onChange: (next: Translations) => void;
  /** Configured locales, in tab order. */
  locales: readonly string[];
  /** Extra locales offered by the add-language action. */
  availableLocales?: readonly string[];
  defaultLocale?: string;
  multiline?: boolean;
  disabled?: boolean;
  labels?: TranslationsInputLabels;
  className?: string;
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: AriaAttributes["aria-invalid"];
  /** Opens on a locale other than the default (demos and server renders). */
  initialLocale?: string;
};

const DEFAULT_LABELS = {
  addLanguage: "Add language",
  emptyTranslation: "No translation yet",
  primary: "Default",
  languagesLabel: "Languages",
};

/**
 * Multi-language text input: locale tabs with a filled/empty indicator, one editor for the active
 * locale, and add/remove actions. The default locale cannot be removed and always stays.
 */
export function TranslationsInput({
  value,
  onChange,
  locales,
  availableLocales,
  defaultLocale,
  multiline = false,
  disabled = false,
  labels,
  className,
  id,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  initialLocale,
}: TranslationsInputProps) {
  const resolved = { ...DEFAULT_LABELS, ...labels };
  const removeLabel = labels?.removeLanguage ?? ((locale: string) => "Remove " + locale);
  const baseId = useId();
  const tabListRef = useRef<HTMLDivElement>(null);
  const [added, setAdded] = useState<readonly string[]>([]);
  const [hidden, setHidden] = useState<readonly string[]>([]);
  const [active, setActive] = useState<string | undefined>(initialLocale);

  const all = orderedLocales(value, locales, added).filter((locale) => !hidden.includes(locale));
  const defaultOf = defaultLocaleOf(all, defaultLocale);
  const activeLocale = resolveActiveLocale(active, all, defaultLocale);
  const addable = addableLocales(availableLocales, orderedLocales(value, locales, added));
  const canRemove = activeLocale !== undefined && activeLocale !== defaultOf && all.length > 1;

  function add(locale: string): void {
    if (locale === "") return;
    setAdded((current) => (current.includes(locale) ? current : [...current, locale]));
    setHidden((current) => current.filter((item) => item !== locale));
    setActive(locale);
    onChange(addLocale(value, locale));
  }

  function remove(): void {
    if (activeLocale === undefined || !canRemove) return;
    setHidden((current) => (current.includes(activeLocale) ? current : [...current, activeLocale]));
    setActive(undefined);
    onChange(removeLocale(value, activeLocale));
  }

  function changeText(text: string): void {
    if (activeLocale === undefined) return;
    onChange({ ...value, [activeLocale]: text });
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    const next = nextTabIndex(event.key, index, all.length);
    if (next === null) return;
    event.preventDefault();
    const target = all[next];
    if (target === undefined) return;
    setActive(target);
    tabListRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  }

  const editorCommon = {
    id,
    disabled,
    "aria-describedby": ariaDescribedBy,
    "aria-invalid": ariaInvalid,
    value: activeLocale === undefined ? "" : (value[activeLocale] ?? ""),
    placeholder: resolved.emptyTranslation,
    onChange: (event: { target: { value: string } }) => changeText(event.target.value),
  };

  return (
    <div className={cx("fc-translations", disabled && "fc-translations--disabled", className)}>
      <div className="fc-translations__header">
        <div
          ref={tabListRef}
          className="fc-translations__tabs"
          role="tablist"
          aria-label={resolved.languagesLabel}
        >
          {all.map((locale, index) => {
            const selected = locale === activeLocale;
            const filled = isFilled(value, locale);
            return (
              <button
                key={locale}
                type="button"
                role="tab"
                id={baseId + locale + "-tab"}
                className="fc-translations__tab"
                aria-selected={selected}
                aria-controls={baseId + "panel"}
                tabIndex={selected ? 0 : -1}
                title={filled ? undefined : resolved.emptyTranslation}
                onClick={() => setActive(locale)}
                onKeyDown={(event) => onTabKeyDown(event, index)}
              >
                <span
                  className={cx(
                    "fc-translations__dot",
                    filled ? "fc-translations__dot--filled" : "fc-translations__dot--empty",
                  )}
                  aria-hidden="true"
                />
                {locale.toUpperCase()}
                {locale === defaultOf ? (
                  <span className="fc-translations__primary">{resolved.primary}</span>
                ) : null}
              </button>
            );
          })}
        </div>

        {canRemove && activeLocale !== undefined ? (
          <button
            type="button"
            className="fc-translations__remove"
            aria-label={removeLabel(activeLocale)}
            disabled={disabled}
            onClick={remove}
          >
            <span aria-hidden="true">×</span>
          </button>
        ) : null}

        {addable.length === 0 ? null : (
          <Select
            className="fc-translations__add"
            aria-label={resolved.addLanguage}
            value=""
            disabled={disabled}
            onChange={(event) => add(event.target.value)}
          >
            <option value="">{resolved.addLanguage}</option>
            {addable.map((locale) => (
              <option key={locale} value={locale}>
                {locale.toUpperCase()}
              </option>
            ))}
          </Select>
        )}
      </div>

      <div
        className="fc-translations__panel"
        role="tabpanel"
        id={baseId + "panel"}
        aria-labelledby={activeLocale === undefined ? undefined : baseId + activeLocale + "-tab"}
      >
        {multiline ? <Textarea {...editorCommon} /> : <Input {...editorCommon} />}
      </div>
    </div>
  );
}
