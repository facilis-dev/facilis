import { useId, useState, type AriaAttributes, type KeyboardEvent } from "react";
import { cx } from "./class-names.ts";
import { filterTagSuggestions, isDuplicateTag, normalizeTag } from "./tag-picker-tags.ts";
import "./tag-picker.css";

export type TagPickerProps = {
  value: readonly string[];
  onChange: (next: string[]) => void;
  options?: readonly string[];
  placeholder?: string;
  removeLabel?: (tag: string) => string;
  suggestionsLabel?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: AriaAttributes["aria-invalid"];
};

/**
 * Chips + free text: Enter/comma commits the typed tag, Backspace on empty input removes the
 * last chip, and the optional suggestion list is filtered from options and already-selected
 * tags. Duplicate protection is case-insensitive after trimming.
 */
export function TagPicker({
  value,
  onChange,
  options,
  placeholder = "Add a tag…",
  removeLabel,
  suggestionsLabel = "Suggestions",
  disabled = false,
  className,
  id,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
}: TagPickerProps) {
  const baseId = useId();
  const listId = baseId + "suggestions";
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);

  const suggestions = options === undefined ? [] : filterTagSuggestions(options, value, query);
  const active =
    activeIndex >= 0 && activeIndex < suggestions.length ? suggestions[activeIndex] : undefined;
  const showSuggestions = !disabled && suggestions.length > 0;

  function commit(raw: string): void {
    const tag = normalizeTag(raw);
    if (tag === "" || isDuplicateTag(value, tag)) {
      setQuery("");
      setActiveIndex(-1);
      return;
    }
    onChange([...value, tag]);
    setQuery("");
    setActiveIndex(-1);
  }

  function remove(tag: string): void {
    onChange(value.filter((item) => item !== tag));
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      if (active !== undefined) commit(active);
      else commit(query);
      return;
    }
    if (event.key === "Backspace" && query === "" && value.length > 0) {
      event.preventDefault();
      onChange(value.slice(0, -1));
      return;
    }
    if (event.key === "ArrowDown" && suggestions.length > 0) {
      event.preventDefault();
      setActiveIndex((current) => (current + 1 >= suggestions.length ? 0 : current + 1));
      return;
    }
    if (event.key === "ArrowUp" && suggestions.length > 0) {
      event.preventDefault();
      setActiveIndex((current) => (current <= 0 ? suggestions.length - 1 : current - 1));
      return;
    }
    if (event.key === "Escape") {
      setQuery("");
      setActiveIndex(-1);
    }
  }

  return (
    <div className={cx("fc-tagpicker", disabled && "fc-tagpicker--disabled", className)}>
      <div className="fc-tagpicker__chips">
        {value.map((tag) => (
          <span className="fc-tagpicker__chip" key={tag}>
            {tag}
            <button
              type="button"
              className="fc-tagpicker__remove"
              aria-label={removeLabel === undefined ? "Remove " + tag : removeLabel(tag)}
              disabled={disabled}
              onClick={() => remove(tag)}
            >
              <span aria-hidden="true">×</span>
            </button>
          </span>
        ))}
        <input
          id={id}
          className="fc-tagpicker__input"
          type="text"
          role="combobox"
          value={query}
          placeholder={value.length === 0 ? placeholder : undefined}
          disabled={disabled}
          aria-expanded={showSuggestions}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            showSuggestions && active !== undefined ? baseId + active : undefined
          }
          aria-describedby={ariaDescribedBy}
          aria-invalid={ariaInvalid}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(-1);
          }}
          onKeyDown={onKeyDown}
        />
      </div>

      {showSuggestions ? (
        <ul
          className="fc-tagpicker__suggestions"
          role="listbox"
          id={listId}
          aria-label={suggestionsLabel}
        >
          {suggestions.map((tag) => (
            <li
              key={tag}
              role="option"
              aria-selected={tag === active}
              className="fc-tagpicker__option"
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(suggestions.indexOf(tag))}
              onClick={() => commit(tag)}
            >
              {tag}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
