// The one-line `unknown` → message helper shared by the error paths that
// report through a toast/status (export, share, share-link boot).

export function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
