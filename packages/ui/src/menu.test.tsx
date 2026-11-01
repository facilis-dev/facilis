import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Menu } from "./menu.tsx";

const items = [
  { label: "Archive project", onSelect: () => undefined },
  { label: "Delete project", tone: "danger" as const, onSelect: () => undefined },
];

describe("Menu", () => {
  it("renders a closed trigger by default", () => {
    const html = renderToStaticMarkup(<Menu label="Actions" items={items} />);

    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="Actions"');
    expect(html).not.toContain('role="menu"');
  });

  it("renders the menu items when opened", () => {
    const html = renderToStaticMarkup(<Menu label="Actions" items={items} defaultOpen />);

    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('role="menu"');
    expect(html).toContain('role="menuitem"');
    expect(html).toContain("Archive project");
    expect(html).toContain("Delete project");
    expect(html).toContain("fc-menu__item--danger");
  });
});
