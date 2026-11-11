/**
 * Canonical email form (D-150). Registration, login, SSO linking and the bootstrap comparison
 * all go through this function: the stored value, the unique `lower(email)` index and every
 * lookup then agree on one identity, so a case variant can never create a second account or
 * be mistaken for another one during the initial-admin promotion.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
