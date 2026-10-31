import { EmptyState, Page } from "@facilis/ui";
import { t } from "@facilis/core/i18n";
import { Link } from "react-router-dom";

/** The catch-all route has no layout, so it centres its own Page container. */
export function NotFoundPage() {
  return (
    <div className="app-standalone">
      <Page title={t("not_found.title")}>
        <EmptyState
          title={t("not_found.title")}
          description={t("not_found.description")}
          action={
            <Link className="fc-btn fc-btn--primary fc-btn--md" to="/todos">
              {t("not_found.action")}
            </Link>
          }
        />
      </Page>
    </div>
  );
}
