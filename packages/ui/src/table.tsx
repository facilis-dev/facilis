import type { ComponentProps } from "react";
import { cx } from "./class-names.ts";

export type TableProps = ComponentProps<"table">;
export type TableHeaderProps = ComponentProps<"thead">;
export type TableBodyProps = ComponentProps<"tbody">;
export type TableFooterProps = ComponentProps<"tfoot">;
export type TableRowProps = ComponentProps<"tr">;
export type TableHeadProps = ComponentProps<"th">;
export type TableCellProps = ComponentProps<"td">;
export type TableCaptionProps = ComponentProps<"caption">;

/**
 * Table owns the horizontal-scroll wrapper so wide tables never push the page sideways;
 * every part below maps one-to-one to its HTML element and only adds its .fc-table__* hook.
 */
export function Table({ className, children, ...props }: TableProps) {
  return (
    <div className="fc-table-wrap">
      <table className={cx("fc-table", className)} {...props}>
        {children}
      </table>
    </div>
  );
}

export function TableHeader({ className, ...props }: TableHeaderProps) {
  return <thead className={cx("fc-table__header", className)} {...props} />;
}

export function TableBody({ className, ...props }: TableBodyProps) {
  return <tbody className={cx("fc-table__body", className)} {...props} />;
}

export function TableFooter({ className, ...props }: TableFooterProps) {
  return <tfoot className={cx("fc-table__footer", className)} {...props} />;
}

export function TableRow({ className, ...props }: TableRowProps) {
  return <tr className={cx("fc-table__row", className)} {...props} />;
}

export function TableHead({ className, ...props }: TableHeadProps) {
  return <th className={cx("fc-table__head-cell", className)} {...props} />;
}

export function TableCell({ className, ...props }: TableCellProps) {
  return <td className={cx("fc-table__cell", className)} {...props} />;
}

export function TableCaption({ className, ...props }: TableCaptionProps) {
  return <caption className={cx("fc-table__caption", className)} {...props} />;
}
