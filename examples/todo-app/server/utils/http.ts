export const SESSION_COOKIE = "facilis_session";

/** Serialize the session cookie. HttpOnly + SameSite=Lax; Secure only in production. */
export function sessionCookie(sessionId: string, maxAgeSeconds: number): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function jsonResponse(
  body: unknown,
  status: number,
  headers: Readonly<Record<string, string>> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

/** Read the session id from a Cookie header without trusting anything else. */
export function sessionIdFromCookieHeader(header: string | null): string | null {
  if (header === null) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) {
      const value = rest.join("=");
      return value.length > 0 ? value : null;
    }
  }
  return null;
}
