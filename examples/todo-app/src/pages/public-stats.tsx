import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { t } from "@facilis.dev/core/i18n";
import { api } from "../lib/api.ts";
import { usePrerenderData } from "../lib/prerender.tsx";

interface PublicStats {
  total: number;
  done: number;
}

/**
 * A public, prerendered landing page (D-202, issue #86). It calls only the permission-free
 * /api/public-stats route, so the build pass serializes that response into the prerender-data
 * island and hydration seeds from it — no refetch-before-hydrate. A shell boot (no island)
 * fetches once in an effect. There is no session guard: the page is anonymous by construction.
 */
export function PublicStatsPage() {
  const island = usePrerenderData();
  const initial = (island?.["/api/public-stats"] as PublicStats | undefined) ?? null;
  const [stats, setStats] = useState<PublicStats | null>(initial);

  useEffect(() => {
    // Island data is the first paint; only a shell boot fetches (no refetch-before-hydrate).
    if (initial !== null) return;
    let alive = true;
    api<PublicStats>("/api/public-stats").then((data) => {
      if (alive) setStats(data);
    });
    return () => {
      alive = false;
    };
  }, [initial]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-8 bg-background px-6 py-20 text-foreground">
      <title>{t("meta.publicStats.title")}</title>
      <meta name="description" content={t("meta.publicStats.description")} />
      <header className="flex flex-col gap-3">
        <h1 className="font-serif text-3xl tracking-tight">{t("publicStats.title")}</h1>
        <p className="leading-relaxed text-muted-foreground">{t("publicStats.description")}</p>
      </header>
      <dl className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1 rounded-lg border border-border bg-card p-6">
          <dt className="text-xs tracking-[0.14em] text-muted-foreground uppercase">
            {t("publicStats.total")}
          </dt>
          <dd className="font-serif text-4xl leading-none">
            {stats === null ? t("common.loading") : stats.total}
          </dd>
        </div>
        <div className="flex flex-col gap-1 rounded-lg border border-border bg-card p-6">
          <dt className="text-xs tracking-[0.14em] text-muted-foreground uppercase">
            {t("publicStats.done")}
          </dt>
          <dd className="font-serif text-4xl leading-none">
            {stats === null ? t("common.loading") : stats.done}
          </dd>
        </div>
      </dl>
      <p className="text-sm leading-relaxed text-muted-foreground">{t("publicStats.note")}</p>
      <nav className="flex flex-wrap gap-3">
        <Link
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          to="/todos"
        >
          {t("publicStats.back")}
        </Link>
        <Link
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium"
          to="/login"
        >
          {t("publicStats.login")}
        </Link>
      </nav>
    </main>
  );
}
