import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StatCard } from "./stat-card.tsx";

describe("StatCard", () => {
  it("renders the label, value, trend and meta", () => {
    const html = renderToStaticMarkup(
      <StatCard
        label="Active projects"
        value="24"
        meta="vs. last month"
        trend={{ direction: "up", value: "12%" }}
        icon={<span>#</span>}
      />,
    );

    expect(html).toContain('class="fc-stat"');
    expect(html).toContain("Active projects");
    expect(html).toContain('<p class="fc-stat__value">24</p>');
    expect(html).toContain("fc-trend--up");
    expect(html).toContain("vs. last month");
    expect(html).toContain('class="fc-stat__icon"');
  });

  it("renders a determinate meter and clamps progress to 0-100", () => {
    const html = renderToStaticMarkup(<StatCard label="Storage" value="7.2 GB" progress={120} />);

    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="100"');
    expect(html).toContain('class="fc-meter__bar"');
    expect(html).toContain("width:100%");
  });

  it("omits the meter when no progress is given", () => {
    expect(renderToStaticMarkup(<StatCard label="Seats" value="8" />)).not.toContain("fc-meter");
  });
});
