import { useEffect, useState } from "react";
import { usePrerenderData } from "../lib/data-context.ts";
import type { StatsPayload } from "../lib/public-api.ts";

function isStatsPayload(value: unknown): value is StatsPayload {
  return (
    typeof value === "object" && value !== null &&
    "items" in value && Array.isArray(value.items) &&
    "total" in value && typeof value.total === "number"
  );
}

// The public-API page: prerendered with build-time data; in SPA-shell mode it
// fetches the same public endpoint client-side (no refetch before hydrate).
export function StatsPage() {
  const prerendered = usePrerenderData();
  const embedded = prerendered?.url === "/stats" && isStatsPayload(prerendered.data) ? prerendered.data : null;
  const [fetched, setFetched] = useState<StatsPayload | null>(null);
  useEffect(() => {
    if (embedded !== null) return;
    let alive = true;
    fetch("/api/stats")
      .then((res) => (res.ok ? res.json() : null))
      .then((json: unknown) => {
        if (alive && isStatsPayload(json)) setFetched(json);
      })
      .catch(() => {
        // The shell mode degrades to an empty list; the prerendered path never fetches.
      });
    return () => {
      alive = false;
    };
  }, [embedded]);
  const data = embedded ?? fetched;
  return (
    <section id="stats-content" data-source={embedded !== null ? "prerender" : "client"}>
      <h1>Public stats</h1>
      {data === null ? (
        <p id="stats-loading">Loading stats…</p>
      ) : (
        <ul>
          {data.items.map((item) => (
            <li key={item.name}>
              {item.name}: {item.value}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
