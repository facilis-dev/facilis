import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DatePickerCalendar } from "./date-picker-calendar.tsx";

const LABELS = {
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

function render(mode: "date" | "datetime"): string {
  return renderToStaticMarkup(
    <DatePickerCalendar
      id="calendar"
      view={{ year: 2024, month: 1 }}
      focused={new Date(2024, 1, 15)}
      selectedDay={new Date(2024, 1, 15)}
      value={new Date(2024, 1, 15, 9, 30)}
      today={new Date(2024, 1, 20)}
      mode={mode}
      minDate={new Date(2024, 1, 10)}
      maxDate={new Date(2024, 1, 25)}
      locale="en-US"
      labels={LABELS}
      gridRef={createRef<HTMLDivElement>()}
      onSelectDay={() => undefined}
      onFocusDay={() => undefined}
      onChangeMonth={() => undefined}
      onChangeTime={() => undefined}
      onToday={() => undefined}
      onClear={() => undefined}
    />,
  );
}

describe("DatePickerCalendar", () => {
  it("renders a Monday-first 6x7 grid with nav and actions", () => {
    const html = render("date");

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-label="Choose date"');
    expect(html).toContain('aria-label="Previous month"');
    expect(html).toContain('aria-label="Next month"');
    expect(html).toContain("February 2024");
    expect(html.match(/data-day="/g)).toHaveLength(42);
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('aria-current="date"');
    expect(html).toContain("Thursday, February 15, 2024");
    expect(html).toContain(">Today<");
    expect(html).toContain(">Clear<");
  });

  it("disables days outside the min/max range", () => {
    const html = render("date");
    const outside = /<button[^>]*data-day="2024-02-09"[^>]*>/.exec(html)?.[0] ?? "";
    const inside = /<button[^>]*data-day="2024-02-15"[^>]*>/.exec(html)?.[0] ?? "";

    expect(outside).toContain("disabled");
    expect(inside).not.toContain("disabled");
  });

  it("renders hour and minute selects only in datetime mode", () => {
    const date = render("date");
    const datetime = render("datetime");

    expect(date).not.toContain("fc-datepicker__time");
    expect(datetime).toContain("fc-datepicker__time");
    expect(datetime).toContain('aria-label="Hours"');
    expect(datetime).toContain('aria-label="Minutes"');
    expect(datetime.match(/<option/g)).toHaveLength(24 + 60);
    expect(datetime).toContain(">09<");
    expect(datetime).toContain(">30<");
  });
});
