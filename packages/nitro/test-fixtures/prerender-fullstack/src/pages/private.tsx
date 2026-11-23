import { useEffect, useState } from "react";
import { api } from "../lib/api.ts";

export function PrivatePage() {
  const [secret, setSecret] = useState<boolean | null>(null);
  useEffect(() => {
    api<{ secret: boolean }>("/api/private").then((data) => setSecret(data.secret));
  }, []);
  return (
    <main>
      <h1>Private</h1>
      <p>{secret === null ? "loading" : String(secret)}</p>
    </main>
  );
}
