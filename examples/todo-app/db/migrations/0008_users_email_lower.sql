-- D-150: canonical email identity. Registration and SSO store emails through
-- normalizeEmail(), and the unique index below rejects a case variant at the database level too.
-- Without it, FACILIS_INITIAL_ADMIN could match an account created with different casing.
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_lower_idx" ON "users" USING btree (lower("email"));
