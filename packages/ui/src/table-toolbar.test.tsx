import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TableToolbar } from "./table-toolbar.tsx";

describe("TableToolbar", () => {
  it("renders the search field, filters and actions slots", () => {
    const html = renderToStaticMarkup(
      <TableToolbar
        search="north"
        onSearchChange={() => undefined}
        searchLabel="Search projects"
        filters={<span>Filters</span>}
        actions={<span>Actions</span>}
      />,
    );

    expect(html).toContain('class="fc-toolbar"');
    expect(html).toContain('class="fc-toolbar__search"');
    expect(html).toContain('type="search"');
    expect(html).toContain('value="north"');
    expect(html).toContain('aria-label="Search projects"');
    expect(html).toContain('class="fc-toolbar__filters"');
    expect(html).toContain('class="fc-toolbar__actions"');
  });

  it("omits the search field and slots when they are not provided", () => {
    const html = renderToStaticMarkup(<TableToolbar />);

    expect(html).toContain("fc-toolbar");
    expect(html).not.toContain("fc-toolbar__search");
    expect(html).not.toContain("fc-toolbar__filters");
    expect(html).not.toContain("fc-toolbar__actions");
  });
});
