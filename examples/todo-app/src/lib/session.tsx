/**
 * Session provider, hooks and route guards (docs/FRONTEND.md section 4).
 *
 * The session cookie is the identity; the client only mirrors GET /api/auth/session into React
 * state so guards and chrome can render from it.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Spinner } from "@facilis/ui";
import { t } from "@facilis/core/i18n";
import { api } from "./api.ts";

export interface Session {
  authenticated: boolean;
  userId?: string;
  roles?: readonly string[];
  permissions?: readonly string[];
}

export interface SessionValue {
  session: Session | null;
  loading: boolean;
  refresh(): Promise<void>;
  logout(): Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

/** Pure permission check for conditional UI: the session decides, never a role name. */
export function hasPermission(session: Session | null, permission: string): boolean {
  if (session === null || !session.authenticated) return false;
  return session.permissions?.includes(permission) ?? false;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const refresh = useCallback(async () => {
    try {
      setSession(await api<Session>("/api/auth/session"));
    } catch {
      // An unreachable session endpoint means "anonymous" to the guards; it must not brick boot.
      setSession({ authenticated: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {
      // The cookie is cleared server-side on every exit path; a failed call must not trap the
      // user in the app, so continue to the anonymous state and the login route.
    }
    await refresh();
    navigate("/login", { replace: true });
  }, [navigate, refresh]);

  const value = useMemo<SessionValue>(
    () => ({ session, loading, refresh, logout }),
    [session, loading, refresh, logout],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (value === null) throw new Error("useSession must be used inside <SessionProvider>");
  return value;
}

function GuardSpinner() {
  return (
    <div className="app-loading">
      <Spinner label={t("common.loading")} />
    </div>
  );
}

/** Renders the route only for an authenticated session; anonymous users go to /login. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useSession();
  const location = useLocation();
  if (loading) return <GuardSpinner />;
  if (session?.authenticated !== true) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}

/** Keeps login/register unreachable once the session exists. */
export function PublicOnly({ children }: { children: ReactNode }) {
  const { session, loading } = useSession();
  if (loading) return <GuardSpinner />;
  if (session?.authenticated === true) return <Navigate to="/todos" replace />;
  return <>{children}</>;
}
