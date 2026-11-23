import { useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import { usePrerenderData } from "../lib/prerender.tsx";

interface Stats {
  count: number;
  source: string;
}

export function StatsPage() {
  const island = usePrerenderData();
  const initial = (island?.["/api/stats"] as Stats | undefined) ?? null;
  const [stats, setStats] = useState<Stats | null>(initial);
  useEffect(() => {
    // Island data is the first paint; only a shell boot fetches (no refetch-before-hydrate).
    if (initial !== null) return;
    let alive = true;
    api<Stats>("/api/stats").then((data) => {
      if (alive) setStats(data);
    });
    return () => {
      alive = false;
    };
  }, [initial]);
  return (
    <main>
      <title>Fixture Stats</title>
      <h1>Stats</h1>
      <p data-source={initial !== null ? "prerender" : "client"}>
        {stats === null ? "loading" : `count=${stats.count}`}
      </p>
    </main>
  );
}
