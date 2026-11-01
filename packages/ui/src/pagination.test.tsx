import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Pagination } from "./pagination.tsx";

describe("Pagination", () => {
  it("renders the range summary and marks the current page", () => {
    const html = renderToStaticMarkup(
      <Pagination page={2} pageCount={3} total={25} pageSize={10} onPageChange={() => undefined} />,
    );

    expect(html).toContain("Showing");
    expect(html).toContain("11–20");
    expect(html).toContain("25");
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('aria-label="Previous page"');
    expect(html).toContain('aria-label="Next page"');
  });

  it("disables previous on the first page and next on the last", () => {
    const first = renderToStaticMarkup(
      <Pagination page={1} pageCount={2} total={15} pageSize={10} onPageChange={() => undefined} />,
    );
    const last = renderToStaticMarkup(
      <Pagination page={2} pageCount={2} total={15} pageSize={10} onPageChange={() => undefined} />,
    );

    expect(first).toContain("disabled");
    expect(last).toContain("disabled");
  });

  it("takes a translated range summary", () => {
    const html = renderToStaticMarkup(
      <Pagination
        page={2}
        pageCount={3}
        total={25}
        pageSize={10}
        onPageChange={() => undefined}
        summaryLabel={({ from, to, total }) => `Mostrando ${from}–${to} di ${total}`}
      />,
    );

    expect(html).toContain("Mostrando");
    expect(html).toContain("11–20");
  });

  it("takes custom navigation labels", () => {
    const html = renderToStaticMarkup(
      <Pagination
        page={1}
        pageCount={2}
        total={5}
        pageSize={10}
        onPageChange={() => undefined}
        previousLabel="Pagina precedente"
        nextLabel="Pagina successiva"
      />,
    );

    expect(html).toContain('aria-label="Pagina precedente"');
    expect(html).toContain('aria-label="Pagina successiva"');
  });
});
