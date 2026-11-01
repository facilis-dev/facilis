import {
  useEffect,
  useId,
  useRef,
  useState,
  type AriaAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { cx } from "./class-names.ts";
import { DatePickerCalendar } from "./date-picker-calendar.tsx";
import {
  addDays,
  addMonths,
  addMonthsClamped,
  dayKey,
  isDayWithin,
  mondayOf,
  startOfDay,
} from "./date-grid.ts";
import { formatDateValue, type DatePickerMode } from "./date-picker-format.ts";
import "./button.css";
import "./icon-button.css";
import "./date-picker.css";

export type DatePickerLabels = {
  previousMonth: string;
  nextMonth: string;
  today: string;
  clear: string;
  chooseTime: string;
  /** Group label for the time row; defaults to Time. */
  timeLabel?: string;
  /** Accessible name for the popover; defaults to Choose date. */
  calendarLabel?: string;
  /** Accessible names for the two time selects. */
  hoursLabel?: string;
  minutesLabel?: string;
};

export type DatePickerProps = {
  value: Date | null;
  onChange: (date: Date | null) => void;
  mode?: DatePickerMode;
  minDate?: Date;
  maxDate?: Date;
  locale?: string;
  labels?: DatePickerLabels;
  disabled?: boolean;
  /** Opens the popover initially (demos and server renders; the picker is otherwise controlled). */
  defaultOpen?: boolean;
  className?: string;
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: AriaAttributes["aria-invalid"];
};

const DEFAULT_LABELS = {
  previousMonth: "Previous month",
  nextMonth: "Next month",
  today: "Today",
  clear: "Clear",
  chooseTime: "Choose time",
  timeLabel: "Time",
  calendarLabel: "Choose date",
  hoursLabel: "Hours",
  minutesLabel: "Minutes",
} as const;

/**
 * Calendar popover with an optional time row. Values are local Dates; serializing them for the
 * API is the app's job through @facilis/time. Monday-first 6x7 grid, min/max by calendar day.
 */
export function DatePicker({
  value,
  onChange,
  mode = "date",
  minDate,
  maxDate,
  locale,
  labels,
  disabled = false,
  defaultOpen = false,
  className,
  id,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
}: DatePickerProps) {
  const resolved = { ...DEFAULT_LABELS, ...labels };
  const baseId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const today = startOfDay(new Date());
  const selectedDay = value === null ? null : startOfDay(value);

  const [open, setOpen] = useState(defaultOpen);
  const [view, setView] = useState(() => {
    const anchor = value ?? new Date();
    return { year: anchor.getFullYear(), month: anchor.getMonth() };
  });
  const [focused, setFocused] = useState<Date>(() => startOfDay(value ?? new Date()));

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    gridRef.current
      ?.querySelector<HTMLButtonElement>('[data-day="' + dayKey(focused) + '"]')
      ?.focus();
  }, [open, focused]);

  function toggle(): void {
    if (open) {
      setOpen(false);
      return;
    }
    const anchor = value ?? new Date();
    setView({ year: anchor.getFullYear(), month: anchor.getMonth() });
    setFocused(startOfDay(anchor));
    setOpen(true);
  }

  function selectDay(day: Date): void {
    if (disabled || !isDayWithin(day, minDate, maxDate)) return;
    // Choosing a day keeps the existing time in datetime mode, so editing a date never resets it.
    const hours = mode === "datetime" && value !== null ? value.getHours() : 0;
    const minutes = mode === "datetime" && value !== null ? value.getMinutes() : 0;
    onChange(new Date(day.getFullYear(), day.getMonth(), day.getDate(), hours, minutes, 0, 0));
    if (mode === "date") {
      setOpen(false);
      triggerRef.current?.focus();
    }
  }

  function changeMonth(amount: number): void {
    const next = addMonths(new Date(view.year, view.month, 1), amount);
    setView({ year: next.getFullYear(), month: next.getMonth() });
    setFocused(addMonthsClamped(focused, amount));
  }

  function changeTime(part: "hours" | "minutes", raw: string): void {
    const base = value ?? focused;
    const next = new Date(
      base.getFullYear(),
      base.getMonth(),
      base.getDate(),
      value?.getHours() ?? 0,
      value?.getMinutes() ?? 0,
      0,
      0,
    );
    if (part === "hours") next.setHours(Number(raw));
    else next.setMinutes(Number(raw));
    onChange(next);
  }

  function selectToday(): void {
    if (!isDayWithin(today, minDate, maxDate)) return;
    const hours = mode === "datetime" && value !== null ? value.getHours() : 0;
    const minutes = mode === "datetime" && value !== null ? value.getMinutes() : 0;
    onChange(
      new Date(today.getFullYear(), today.getMonth(), today.getDate(), hours, minutes, 0, 0),
    );
    setFocused(today);
    setView({ year: today.getFullYear(), month: today.getMonth() });
    if (mode === "date") {
      setOpen(false);
      triggerRef.current?.focus();
    }
  }

  function clearValue(): void {
    onChange(null);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function onGridKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    let next: Date;
    switch (event.key) {
      case "ArrowLeft":
        next = addDays(focused, -1);
        break;
      case "ArrowRight":
        next = addDays(focused, 1);
        break;
      case "ArrowUp":
        next = addDays(focused, -7);
        break;
      case "ArrowDown":
        next = addDays(focused, 7);
        break;
      case "Home":
        next = mondayOf(focused);
        break;
      case "End":
        next = addDays(mondayOf(focused), 6);
        break;
      case "PageUp":
        next = addMonthsClamped(focused, -1);
        break;
      case "PageDown":
        next = addMonthsClamped(focused, 1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        selectDay(focused);
        return;
      default:
        return;
    }
    event.preventDefault();
    setFocused(next);
    setView({ year: next.getFullYear(), month: next.getMonth() });
  }

  return (
    <div className={cx("fc-datepicker", className)} ref={rootRef}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className="fc-datepicker__trigger"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        onClick={toggle}
      >
        <span>{formatDateValue(value, mode, locale)}</span>
        <span className="fc-datepicker__chevron" aria-hidden="true">
          ▾
        </span>
      </button>

      {open ? (
        <div onKeyDown={onGridKeyDown}>
          <DatePickerCalendar
            id={baseId}
            view={view}
            focused={focused}
            selectedDay={selectedDay}
            value={value}
            today={today}
            mode={mode}
            minDate={minDate}
            maxDate={maxDate}
            locale={locale}
            labels={resolved}
            gridRef={gridRef}
            onSelectDay={selectDay}
            onFocusDay={setFocused}
            onChangeMonth={changeMonth}
            onChangeTime={changeTime}
            onToday={selectToday}
            onClear={clearValue}
          />
        </div>
      ) : null}
    </div>
  );
}
