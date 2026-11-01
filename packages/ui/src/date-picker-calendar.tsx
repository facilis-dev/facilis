import type { RefObject } from "react";
import { cx } from "./class-names.ts";
import { buildMonthGrid, dayKey, isDayWithin, isSameDay } from "./date-grid.ts";
import {
  formatDayLabel,
  formatMonthTitle,
  getWeekdayLabels,
  pad2,
  type DatePickerMode,
} from "./date-picker-format.ts";
import type { DatePickerLabels } from "./date-picker.tsx";

const HOURS = Array.from({ length: 24 }, (_, index) => index);
const MINUTES = Array.from({ length: 60 }, (_, index) => index);

export type DatePickerCalendarProps = {
  id: string;
  view: { year: number; month: number };
  focused: Date;
  selectedDay: Date | null;
  value: Date | null;
  today: Date;
  mode: DatePickerMode;
  minDate?: Date;
  maxDate?: Date;
  locale?: string;
  labels: Required<DatePickerLabels>;
  gridRef: RefObject<HTMLDivElement | null>;
  onSelectDay: (day: Date) => void;
  onFocusDay: (day: Date) => void;
  onChangeMonth: (amount: number) => void;
  onChangeTime: (part: "hours" | "minutes", raw: string) => void;
  onToday: () => void;
  onClear: () => void;
};

/**
 * Presentational calendar popover: nav, weekday header, 6x7 day grid, optional time row and
 * the today/clear actions. All state and keyboard handling live in the DatePicker wrapper, so
 * this module only renders and reports intent.
 */
export function DatePickerCalendar({
  id,
  view,
  focused,
  selectedDay,
  value,
  today,
  mode,
  minDate,
  maxDate,
  locale,
  labels,
  gridRef,
  onSelectDay,
  onFocusDay,
  onChangeMonth,
  onChangeTime,
  onToday,
  onClear,
}: DatePickerCalendarProps) {
  const days = buildMonthGrid(view.year, view.month);

  return (
    <div className="fc-datepicker__popover" role="dialog" aria-label={labels.calendarLabel} id={id}>
      <div className="fc-datepicker__header">
        <button
          type="button"
          className="fc-icon-btn fc-icon-btn--sm"
          aria-label={labels.previousMonth}
          onClick={() => onChangeMonth(-1)}
        >
          <span aria-hidden="true">‹</span>
        </button>
        <span className="fc-datepicker__month">
          {formatMonthTitle(view.year, view.month, locale)}
        </span>
        <button
          type="button"
          className="fc-icon-btn fc-icon-btn--sm"
          aria-label={labels.nextMonth}
          onClick={() => onChangeMonth(1)}
        >
          <span aria-hidden="true">›</span>
        </button>
      </div>

      <div className="fc-datepicker__weekdays" aria-hidden="true">
        {getWeekdayLabels(locale).map((label, index) => (
          <span className="fc-datepicker__weekday" key={index}>
            {label}
          </span>
        ))}
      </div>

      <div className="fc-datepicker__grid" ref={gridRef}>
        {days.map((day) => (
          <button
            key={dayKey(day)}
            type="button"
            className={cx(
              "fc-datepicker__day",
              day.getMonth() !== view.month && "fc-datepicker__day--outside",
              isSameDay(day, today) && "fc-datepicker__day--today",
            )}
            data-day={dayKey(day)}
            tabIndex={isSameDay(day, focused) ? 0 : -1}
            disabled={!isDayWithin(day, minDate, maxDate)}
            aria-selected={selectedDay !== null && isSameDay(day, selectedDay)}
            aria-current={isSameDay(day, today) ? "date" : undefined}
            aria-label={formatDayLabel(day, locale)}
            onFocus={() => onFocusDay(day)}
            onClick={() => onSelectDay(day)}
          >
            {day.getDate()}
          </button>
        ))}
      </div>

      {mode === "datetime" ? (
        <div className="fc-datepicker__time" role="group" aria-label={labels.timeLabel}>
          <span className="fc-datepicker__time-label">{labels.chooseTime}</span>
          <select
            className="fc-datepicker__time-select"
            aria-label={labels.hoursLabel}
            value={value?.getHours() ?? 0}
            onChange={(event) => onChangeTime("hours", event.target.value)}
          >
            {HOURS.map((hour) => (
              <option key={hour} value={hour}>
                {pad2(hour)}
              </option>
            ))}
          </select>
          <span aria-hidden="true">:</span>
          <select
            className="fc-datepicker__time-select"
            aria-label={labels.minutesLabel}
            value={value?.getMinutes() ?? 0}
            onChange={(event) => onChangeTime("minutes", event.target.value)}
          >
            {MINUTES.map((minute) => (
              <option key={minute} value={minute}>
                {pad2(minute)}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="fc-datepicker__actions">
        <button
          type="button"
          className="fc-btn fc-btn--ghost fc-btn--sm"
          onClick={onToday}
          disabled={!isDayWithin(today, minDate, maxDate)}
        >
          {labels.today}
        </button>
        <button
          type="button"
          className="fc-btn fc-btn--ghost fc-btn--sm"
          onClick={onClear}
          disabled={value === null}
        >
          {labels.clear}
        </button>
      </div>
    </div>
  );
}
