import { z } from "zod";
import { defineAuthorizedHandler, fail } from "@facilis/core";
import { consumeEmailVerification, EMAIL_VERIFICATION_TABLES } from "@facilis/auth";
import config from "~/facilis.config";
import { redirectWith } from "~/server/utils/email-verification";

function redirect(path: string, name: string, value: string): Response {
  // A relative Location keeps the app under whatever base path it is served from (the IDE
  // preview mounts it under /preview/<port>); the browser resolves it against the request URL.
  return new Response(null, {
    status: 302,
    headers: { location: redirectWith(path, name, value) },
  });
}

/**
 * Consumes the single-use verification link (D-156). Public by design: the token is the
 * credential, the browser arrives here from the email and has no session yet. The account is
 * verified inside the audited `system:auth` elevation (the caller has no permission on the auth
 * tables), and every outcome is a redirect carrying only a safe code — never the email, the
 * token or a stack trace.
 */
export default defineAuthorizedHandler(
  {
    permission: [],
    query: z.object({ token: z.string().min(1).max(512) }),
    dbTables: ["auth_email_verifications", "users"],
    dbColumns: [
      "auth_email_verifications.userId",
      "auth_email_verifications.expiresAt",
      "users.emailVerifiedAt",
    ],
    description: "Consume an email verification link and redirect to the login page.",
  },
  async (_event, { query, system, log }) => {
    const verification = config.auth.verification;
    // A deployment that does not use email verification exposes no verifying surface.
    if (!verification.enabled) return fail("not_found");

    const result = await system(
      {
        actor: "system:auth",
        operation: "auth:email:verify",
        reason: "The verification link is consumed before a session exists.",
        tables: EMAIL_VERIFICATION_TABLES,
      },
      (systemDb) => consumeEmailVerification(systemDb, query.token),
    );

    if (result === null) {
      log.audit({ operation: "auth:email:verify", outcome: "failed", errorCode: "invalid_token" });
      return redirect(verification.failureRedirect, "verify_error", "invalid_token");
    }

    log.audit({ operation: "auth:email:verify", outcome: "succeeded" });
    return redirect(verification.successRedirect, "verified", "1");
  },
);
