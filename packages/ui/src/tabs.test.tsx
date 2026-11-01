import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Tabs } from "./tabs.tsx";

const tabs = [
  { id: "profile", label: "Profile", content: <p>Profile panel</p> },
  { id: "billing", label: "Billing", content: <p>Billing panel</p> },
] as const;

describe("Tabs", () => {
  it("renders an accessible tab list with the first tab selected", () => {
    const html = renderToStaticMarkup(<Tabs label="Settings sections" tabs={tabs} />);

    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Settings sections"');
    expect(html).toContain('role="tab"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('aria-selected="false"');
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain("aria-labelledby");
    expect(html).toContain("Profile panel");
    expect(html).not.toContain("Billing panel");
  });

  it("selects the initial tab when asked", () => {
    const html = renderToStaticMarkup(
      <Tabs label="Settings sections" tabs={tabs} initialId="billing" />,
    );

    expect(html).toContain("Billing panel");
    expect(html).not.toContain("Profile panel");
  });
});
