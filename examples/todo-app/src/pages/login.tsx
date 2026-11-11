import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { t } from "@facilis.dev/core/i18n";
import { Alert } from "../components/ui/alert.tsx";
import { AuthShell } from "../components/ui/auth-shell.tsx";
import { Button, buttonVariants } from "../components/ui/button.tsx";
import { Field } from "../components/ui/field.tsx";
import { Input } from "../components/ui/input.tsx";
import { api, appBasePath, errorMessageKey } from "../lib/api.ts";
import { rememberEmail, useSession } from "../lib/session.tsx";

/** One configured SSO provider as returned by GET /api/auth/sso/providers (D-120). */
interface SsoProvider {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  readonly startUrl: string;
}

const SSO_ERROR_KEYS = new Set([
  "sso_provider_unknown",
  "sso_provider_unavailable",
  "sso_state_invalid",
  "sso_exchange_failed",
  "sso_identity_invalid",
  "sso_email_unverified",
  "sso_email_conflict",
  "sso_account_not_found",
  "sso_internal_error",
]);

/** Maps a query-string `sso_error` code to its catalogue key; unknown codes stay generic. */
function ssoErrorKey(code: string | null): string | null {
  if (code === null || code.length === 0) return null;
  return SSO_ERROR_KEYS.has(code) ? `auth.sso.error.${code}` : "auth.sso.error.unknown";
}

/** Where RequireAuth sent the user before login; "/todos" when they arrived directly. */
function targetPath(state: unknown): string {
  if (typeof state === "object" && state !== null && "from" in state) {
    const from = (state as { from: unknown }).from;
    if (typeof from === "string" && from.length > 0) return from;
  }
  return "/todos";
}

/** The framework start URL, carrying the post-login path (same-origin, validated server-side). */
function startHref(provider: SsoProvider, state: unknown): string {
  const redirect = encodeURIComponent(appBasePath() + targetPath(state));
  return appBasePath() + provider.startUrl + "?redirect=" + redirect;
}

export function LoginPage() {
  const { refresh } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [providers, setProviders] = useState<readonly SsoProvider[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // The provider list is optional decoration: a project without SSO returns an empty list and a
  // failed fetch must never break password sign-in.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const payload = await api<{ providers: SsoProvider[] }>("/api/auth/sso/providers");
        if (active) setProviders(payload.providers);
      } catch {
        if (active) setProviders([]);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // The verification route redirects here (D-156): surface the outcome once, then drop the
  // parameter so a reload does not repeat the toast.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const verified = params.get("verified") === "1";
    const failed = params.has("verify_error");
    if (!verified && !failed) return;
    if (verified) {
      toast.success(t("auth.login.email_verified"));
    } else {
      toast.error(t("auth.login.email_verify_failed"));
    }
    params.delete("verified");
    params.delete("verify_error");
    const search = params.toString();
    navigate(
      { pathname: location.pathname, search: search.length === 0 ? "" : "?" + search },
      { replace: true },
    );
  }, [location.pathname, location.search, navigate]);

  const errorKey = ssoErrorKey(new URLSearchParams(location.search).get("sso_error"));

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    try {
      await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      rememberEmail(email);
      await refresh();
      navigate(targetPath(location.state), { replace: true });
    } catch (error) {
      toast.error(t(errorMessageKey(error)));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      title={t("auth.login.title")}
      subtitle={t("auth.login.subtitle")}
      footer={
        <>
          {t("auth.login.footer")}{" "}
          <Link className="font-medium text-primary hover:underline" to="/register">
            {t("auth.login.to_register")}
          </Link>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {errorKey === null ? null : <Alert variant="destructive">{t(errorKey)}</Alert>}
        <form className="flex flex-col gap-4" onSubmit={(event) => void handleSubmit(event)}>
          <Field label={t("auth.email")}>
            <Input
              type="email"
              autoComplete="email"
              autoFocus
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          <Field label={t("auth.password")}>
            <Input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          <Button type="submit" disabled={submitting} className="w-full">
            {t("auth.login.submit")}
          </Button>
        </form>
        {providers.length === 0 ? null : (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              <span className="h-px flex-1 bg-border" />
              {t("auth.sso.or")}
              <span className="h-px flex-1 bg-border" />
            </div>
            {providers.map((provider) => (
              <a
                key={provider.id}
                href={startHref(provider, location.state)}
                className={buttonVariants({ variant: "outline" })}
              >
                {provider.label}
              </a>
            ))}
          </div>
        )}
      </div>
    </AuthShell>
  );
}
