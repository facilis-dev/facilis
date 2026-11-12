import { t } from "@facilis.dev/core/i18n";
import { Button } from "../components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card.tsx";
import { Page } from "../components/ui/page.tsx";
import { rememberedEmail, useSession } from "../lib/session.tsx";

/**
 * The template's landing page: proof that the session works and the place the app grows from.
 * Deliberately not a feature page — a generated project starts empty.
 */
export function DashboardPage() {
  const { logout } = useSession();
  const email = rememberedEmail();

  return (
    <Page title={t("dashboard.title")} description={t("dashboard.description")}>
      <Card>
        <CardHeader>
          <CardTitle>{t("dashboard.signed_in")}</CardTitle>
          <CardDescription>
            {email === null ? t("dashboard.signed_in_hint") : t("dashboard.email", { email })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => void logout()}>
            {t("auth.logout")}
          </Button>
        </CardContent>
      </Card>
    </Page>
  );
}
