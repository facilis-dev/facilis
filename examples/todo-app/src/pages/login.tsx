import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AuthShell, Button, Field, Input, toast } from "@facilis/ui";
import { t } from "@facilis/core/i18n";
import { api, errorMessageKey } from "../lib/api.ts";
import { useSession } from "../lib/session.tsx";

/** Where RequireAuth sent the user before login; "/todos" when they arrived directly. */
function targetPath(state: unknown): string {
  if (typeof state === "object" && state !== null && "from" in state) {
    const from = (state as { from: unknown }).from;
    if (typeof from === "string" && from.length > 0) return from;
  }
  return "/todos";
}

export function LoginPage() {
  const { refresh } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    try {
      await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
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
        <p>
          {t("auth.login.footer")} <Link to="/register">{t("auth.login.to_register")}</Link>
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
        <Field label={t("auth.password")}>
          <Input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        <Button type="submit" disabled={submitting}>
          {t("auth.login.submit")}
        </Button>
      </form>
    </AuthShell>
  );
}
