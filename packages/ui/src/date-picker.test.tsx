import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DatePicker } from "./date-picker.tsx";

function renderOpen(value: Date | null, extra: Partial<Parameters<typeof DatePicker>[0]> = {}) {
  return renderToStaticMarkup(
    <DatePicker value={value} onChange={() => undefined} defaultOpen locale="en-US" {...extra} />,
  );
}

describe("DatePicker", () => {
  it("renders a closed trigger with the formatted value", () => {
    const html = renderToStaticMarkup(
      <DatePicker value={new Date(2024, 1, 15)} onChange={() => undefined} locale="en-US" />,
    );

    expect(html).toContain('class="fc-datepicker"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Feb 15, 2024");
    expect(html).not.toContain("fc-datepicker__popover");
  });

  it("opens the calendar with the selected day and month", () => {
    const html = renderOpen(new Date(2024, 1, 15));

    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("fc-datepicker__popover");
    expect(html).toContain("February 2024");
    expect(html.match(/data-day="/g)).toHaveLength(42);
    expect(html).toContain('aria-label="Thursday, February 15, 2024"');
  });

  it("disables the trigger when disabled", () => {
    const html = renderToStaticMarkup(
      <DatePicker value={null} onChange={() => undefined} disabled locale="en-US" />,
    );
    expect(html).toContain("disabled");
    expect(html).toContain("—");
  });

  it("honours min/max and custom labels", () => {
    const html = renderOpen(new Date(2024, 1, 15), {
      minDate: new Date(2024, 1, 10),
      maxDate: new Date(2024, 1, 20),
      labels: {
        previousMonth: "Mese precedente",
        nextMonth: "Mese successivo",
        today: "Oggi",
        clear: "Cancella",
        chooseTime: "Scegli orario",
      },
    });

    expect(html).toContain('aria-label="Mese precedente"');
    expect(html).toContain('aria-label="Mese successivo"');
    expect(html).toContain(">Oggi<");
    expect(html).toContain(">Cancella<");

    const before = /<button[^>]*data-day="2024-02-09"[^>]*>/.exec(html)?.[0] ?? "";
    expect(before).toContain("disabled");
  });

  it("shows the time row in datetime mode", () => {
    const html = renderOpen(new Date(2024, 1, 15, 9, 30), { mode: "datetime" });

    expect(html).toContain("fc-datepicker__time");
    expect(html).toContain("Choose time");
    expect(html).toContain("Feb 15, 2024");
    expect(html.match(/<option/g)).toHaveLength(24 + 60);
  });

  it("forwards Field wiring props to the trigger", () => {
    const html = renderToStaticMarkup(
      <DatePicker
        value={null}
        onChange={() => undefined}
        id="start-date"
        aria-describedby="start-date-hint"
        aria-invalid
      />,
    );

    expect(html).toContain('id="start-date"');
    expect(html).toContain('aria-describedby="start-date-hint"');
    expect(html).toContain('aria-invalid="true"');
  });
});
