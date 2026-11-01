import { useEffect, useId, useRef, useState, type AriaAttributes, type KeyboardEvent } from "react";
import { cx } from "./class-names.ts";
import { filterOptions, moveIndex, type FilterableOption } from "./combobox-filter.ts";
import "./combobox.css";

export type ComboboxOption = FilterableOption;

export type ComboboxProps = {
  options: readonly ComboboxOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  emptyLabel?: string;
  clearLabel?: string;
  disabled?: boolean;
  /** Opens the list initially (demos and server renders; the combobox is otherwise controlled). */
  defaultOpen?: boolean;
  className?: string;
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: AriaAttributes["aria-invalid"];
};

/**
 * Single-value searchable select. The input doubles as the trigger, filters by label then value,
 * and owns the combobox/listbox aria wiring plus ArrowUp/Down/Home/End/Enter/Escape navigation.
 */
export function Combobox({
  options,
  value,
  onChange,
  placeholder = "Select…",
  emptyLabel = "No matches",
  clearLabel = "Clear",
  disabled = false,
  defaultOpen = false,
  className,
  id,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
}: ComboboxProps) {
  const baseId = useId();
  const listId = baseId + "list";
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(defaultOpen);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const selected = options.find((option) => option.value === value) ?? null;
  const filtered = filterOptions(options, query);
  const active =
    activeIndex >= 0 && activeIndex < filtered.length ? filtered[activeIndex] : undefined;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function choose(option: ComboboxOption): void {
    onChange(option.value);
    setQuery("");
    setOpen(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => moveIndex(current, 1, filtered.length));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => moveIndex(current, -1, filtered.length));
    } else if (event.key === "Home" && open) {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End" && open) {
      event.preventDefault();
      setActiveIndex(Math.max(0, filtered.length - 1));
    } else if (event.key === "Enter" && open && active !== undefined) {
      event.preventDefault();
      choose(active);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
      setQuery("");
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  }

  function optionId(option: ComboboxOption): string {
    return baseId + "option-" + option.value;
  }

  return (
    <div className={cx("fc-combobox", className)} ref={rootRef}>
      <div className="fc-combobox__field">
        <input
          id={id}
          className="fc-combobox__input"
          type="text"
          role="combobox"
          autoComplete="off"
          value={open ? query : (selected?.label ?? "")}
          placeholder={placeholder}
          disabled={disabled}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && active !== undefined ? optionId(active) : undefined}
          aria-describedby={ariaDescribedBy}
          aria-invalid={ariaInvalid}
          onFocus={() => {
            setQuery("");
            setOpen(true);
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
        />
        {value === null || disabled ? null : (
          <button
            type="button"
            className="fc-combobox__clear"
            aria-label={clearLabel}
            onClick={() => {
              onChange(null);
              setQuery("");
              setOpen(false);
            }}
          >
            <span aria-hidden="true">×</span>
          </button>
        )}
      </div>

      {open ? (
        <ul className="fc-combobox__list" role="listbox" id={listId}>
          {filtered.length === 0 ? (
            <li className="fc-combobox__empty">{emptyLabel}</li>
          ) : (
            filtered.map((option) => (
              <li
                key={option.value}
                id={optionId(option)}
                role="option"
                className="fc-combobox__option"
                aria-selected={option.value === value}
                data-active={option === active ? "true" : undefined}
                onMouseEnter={() => setActiveIndex(filtered.indexOf(option))}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(option)}
              >
                <span>{option.label}</span>
                {option.hint === undefined ? null : (
                  <span className="fc-combobox__hint">{option.hint}</span>
                )}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
