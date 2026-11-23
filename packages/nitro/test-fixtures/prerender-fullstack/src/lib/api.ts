import { hasIslandResponse, readIslandResponse } from "./prerender.tsx";

export async function api<T>(path: string): Promise<T> {
  if (hasIslandResponse(path)) return structuredClone(readIslandResponse(path)) as T;
  const response = await fetch(path, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`api ${path} returned ${response.status}`);
  return (await response.json()) as T;
}
