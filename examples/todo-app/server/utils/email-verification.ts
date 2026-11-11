import type { FacilisHandlerEvent } from "@facilis.dev/core";

/**
 * Delivery of the email-verification link (D-156) for the example app.
 *
 * The framework owns the single-use token; the PROJECT owns the mailbox. A production deploy
 * sets `FACILIS_EMAIL_WEBHOOK_URL` (and optionally `FACILIS_EMAIL_WEBHOOK_TOKEN`) to an
 * endpoint that accepts `{ to, subject, text }` and sends the mail; there is no bundled SMTP
 * client and no provider secret in the committed config. In `development`/`test` without a
 * webhook the link is logged and the account is verified immediately, so the demo and the IDE
 * smoke run need no mailbox. The detection is fail-closed exactly like D-146: only an explicit
 * `development`/`test` is dev, an unset or unknown NODE_ENV is treated as production.
 */
export interface VerificationDelivery {
  /** A webhook accepted the mail. */
  readonly delivered: boolean;
  /** No delivery channel in dev: the caller verifies the account directly. */
  readonly devShortcut: boolean;
}

function isExplicitDev(): boolean {
  const environment = process.env.NODE_ENV;
  return environment === "development" || environment === "test";
}

/** Absolute link for the single-use token, honouring FACILIS_PUBLIC_ORIGIN behind a proxy. */
export function verificationUrl(event: FacilisHandlerEvent, token: string): string {
  const requestUrl = new URL(event.req.url ?? "http://localhost/");
  const path = requestUrl.pathname;
  // The app may be mounted under a prefix (the IDE preview serves /preview/<port>/...): keep
  // everything before the route's own path so the link resolves wherever the app really lives.
  const routeIndex = path.lastIndexOf("/api/auth/register");
  const prefix = routeIndex === -1 ? "" : path.slice(0, routeIndex);
  const origin = process.env.FACILIS_PUBLIC_ORIGIN?.trim() ?? requestUrl.origin;
  return `${origin.replace(/\/+$/, "")}${prefix}/api/auth/verify-email?token=${encodeURIComponent(token)}`;
}

/** Same-origin redirect path with one query parameter (the verify route's Location header). */
export function redirectWith(path: string, name: string, value: string): string {
  const url = new URL(path, "http://facilis.invalid");
  url.searchParams.set(name, value);
  return `${url.pathname}${url.search}`;
}

/**
 * Sends the verification link, or falls back to the dev shortcut. A failed webhook throws: the
 * caller logs it and still returns the generic registration response (no enumeration).
 */
export async function deliverVerificationEmail(input: {
  readonly to: string;
  readonly link: string;
}): Promise<VerificationDelivery> {
  const webhook = process.env.FACILIS_EMAIL_WEBHOOK_URL?.trim();
  if (webhook !== undefined && webhook.length > 0) {
    const token = process.env.FACILIS_EMAIL_WEBHOOK_TOKEN?.trim();
    const response = await fetch(webhook, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token === undefined || token.length === 0 ? {} : { authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify({
        to: input.to,
        subject: "Verify your email",
        text: `Confirm your email address: ${input.link}\n\nThe link expires in 24 hours.`,
      }),
    });
    if (!response.ok) throw new Error(`email webhook answered ${response.status}`);
    return { delivered: true, devShortcut: false };
  }
  if (!isExplicitDev()) throw new Error("FACILIS_EMAIL_WEBHOOK_URL is required in production");
  // Dev sink: the developer/operator reads the link from the dev server output.
  console.info(`facilis: verification link for ${input.to}: ${input.link}`);
  return { delivered: false, devShortcut: true };
}
