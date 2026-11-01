import { cx } from "./class-names.ts";
import "./pagination.css";

export type PaginationSummary = {
  page: number;
  pageCount: number;
  total: number;
  from: number;
  to: number;
};

export type PaginationProps = {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  /** Injected by the app so the range summary follows the active locale. */
  summaryLabel?: (summary: PaginationSummary) => string;
  previousLabel?: string;
  nextLabel?: string;
  className?: string;
};

/** Summary + page buttons; the current page carries aria-current and the raised chip. */
export function Pagination({
  page,
  pageCount,
  total,
  pageSize,
  onPageChange,
  summaryLabel,
  previousLabel = "Previous page",
  nextLabel = "Next page",
  className,
}: PaginationProps) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const pages = Array.from({ length: pageCount }, (_, index) => index + 1);

  return (
    <div className={cx("fc-pagination", className)}>
      <p className="fc-pagination__summary">
        {summaryLabel === undefined ? (
          <>
            Showing{" "}
            <span className="fc-pagination__value">
              {from}–{to}
            </span>{" "}
            of <span className="fc-pagination__value">{total}</span>
          </>
        ) : (
          summaryLabel({ page, pageCount, total, from, to })
        )}
      </p>
      <div className="fc-pagination__pages">
        <button
          type="button"
          className="fc-page-btn"
          aria-label={previousLabel}
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <span aria-hidden="true">‹</span>
        </button>
        {pages.map((number) => (
          <button
            key={number}
            type="button"
            className="fc-page-btn"
            aria-current={number === page ? "page" : undefined}
            onClick={() => onPageChange(number)}
          >
            {number}
          </button>
        ))}
        <button
          type="button"
          className="fc-page-btn"
          aria-label={nextLabel}
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
        >
          <span aria-hidden="true">›</span>
        </button>
      </div>
    </div>
  );
}
