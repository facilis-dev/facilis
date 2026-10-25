import { useEffect, useState } from "react";

export default function App() {
  const [health, setHealth] = useState<string>("loading");
  const [revision, setRevision] = useState<string>("loading");

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((j) => setHealth(j.status))
      .catch((e) => setHealth("error: " + String(e)));
    fetch("/__facilis/manifest")
      .then((r) => r.json())
      .then((j) => setRevision(j.revision))
      .catch((e) => setRevision("error: " + String(e)));
  }, []);

  return (
    <main style={{ fontFamily: "system-ui", padding: 24 }}>
      <h1>Facilis Phase 0 Spike</h1>
      <p>Nitro-in-Vite OK — API health: {health}</p>
      <p>Manifest revision: {revision}</p>
    </main>
  );
}
