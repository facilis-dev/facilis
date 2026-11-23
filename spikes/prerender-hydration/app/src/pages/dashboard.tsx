// The auth-guarded page: never prerendered (not in the allowlist), always a shell.
export function DashboardPage() {
  return (
    <section id="dashboard-content">
      <h1>Signed-in dashboard</h1>
      <p>This page is client-only and must never appear in prerendered output.</p>
    </section>
  );
}
