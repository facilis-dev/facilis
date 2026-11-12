import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { t } from "@facilis.dev/core/i18n";
import { Alert } from "../components/ui/alert.tsx";
import { AuthShell } from "../components/ui/auth-shell.tsx";
import { Button } from "../components/ui/button.tsx";
import { Field } from "../components/ui/field.tsx";
import { Input } from "../components/ui/input.tsx";
import { api, errorMessageKey } from "../lib/api.ts";
import { loginTarget, rememberEmail, useSession } from "../lib/session.tsx";

export function LoginPage() {
  const { refresh } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorKey(null);
    setSubmitting(true);
    try {
      await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      rememberEmail(email);
      await refresh();
      navigate(loginTarget(location.state), { replace: true });
    } catch (error) {
      setErrorKey(errorMessageKey(error));
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
      </div>
    </AuthShell>
  );
}
