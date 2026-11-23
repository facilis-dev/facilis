import { useEffect, useState, type ReactNode } from "react";

// Client-only session read: the server never sees a session, and the guarded
// page is never in the prerender allowlist (epic rule 2/3).
function readSession(): string | null {
  if (typeof window === "undefined" || typeof localStorage === "undefined") return null;
  try {
    return localStorage.getItem("spike-session");
  } catch {
    return null;
  }
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<string | null>(null);
  useEffect(() => {
    setSession(readSession());
  }, []);
  if (session === null) {
    return <div id="auth-shell">Sign-in required — this page stays a client-only shell.</div>;
  }
  return <>{children}</>;
}
