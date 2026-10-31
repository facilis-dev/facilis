import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AuthShell, Button, Field, Input, toast } from "@facilis/ui";
import { t } from "@facilis/core/i18n";
import { api, errorMessageKey } from "../lib/api.ts";
import { useSession } from "../lib/session.tsx";

const MIN_PASSWORD_LENGTH = 8;

function targetPath(state: unknown): string {
  if (typeof state === "object" && state !== null && "from" in state) {
    const from = (state as { from: unknown }).from;
    if (typeof from === "string" && from.length > 0) return from;
  }
  return "/todos";
}

export function RegisterPage() {
  const { refresh } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // The server enforces z.string().min(8); check it here too so the user gets an inline
    // message instead of a round-trip that ends in errors.invalid_input.
    if (password.length < MIN_PASSWORD_LENGTH) {
      setPasswordError(t("auth.password.too_short"));
      return;
    }
    setPasswordError(null);
    setSubmitting(true);
    try {
      await api("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      // POST /api/auth/register creates the user but does not start a session (server contract),
      // so sign in with the same credentials before landing on the protected route.
      await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      await refresh();
      toast.success(t("auth.register.success"));
      navigate(targetPath(location.state), { replace: true });
    } catch (error) {
      toast.error(t(errorMessageKey(error)));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      title={t("auth.register.title")}
      subtitle={t("auth.register.subtitle")}
      footer={
        <p>
          {t("auth.register.footer")} <Link to="/login">{t("auth.register.to_login")}</Link>
        </p>
      }
    >
      <form className="app-form" onSubmit={(event) => void handleSubmit(event)}>
        <Field label={t("auth.email")}>
          <Input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
        <Field
          label={t("auth.password")}
          hint={passwordError === null ? t("auth.password.hint") : undefined}
          error={passwordError ?? undefined}
        >
          <Input
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        <Button type="submit" disabled={submitting}>
          {t("auth.register.submit")}
        </Button>
      </form>
    </AuthShell>
  );
}
