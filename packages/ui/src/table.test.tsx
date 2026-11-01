import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "./table.tsx";

describe("Table", () => {
  it("wraps the table in the scroll container and maps every part to its element", () => {
    const html = renderToStaticMarkup(
      <Table>
        <TableCaption>Users</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>Ada</TableCell>
          </TableRow>
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell>1 user</TableCell>
          </TableRow>
        </TableFooter>
      </Table>,
    );

    expect(html).toContain('<div class="fc-table-wrap">');
    expect(html).toContain('<table class="fc-table">');
    expect(html).toContain('<caption class="fc-table__caption">Users</caption>');
    expect(html).toContain('<thead class="fc-table__header">');
    expect(html).toContain('<tbody class="fc-table__body">');
    expect(html).toContain('<tfoot class="fc-table__footer">');
    expect(html).toContain('<tr class="fc-table__row">');
    expect(html).toContain('<th class="fc-table__head-cell">Name</th>');
    expect(html).toContain('<td class="fc-table__cell">Ada</td>');
    expect(html).toContain("1 user");
  });

  it("merges a custom class on the table itself", () => {
    expect(renderToStaticMarkup(<Table className="extra" />)).toContain(
      '<table class="fc-table extra">',
    );
  });
});
