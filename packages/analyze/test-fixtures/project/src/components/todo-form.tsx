import { api } from "../lib/api.ts";

export async function save(title: string): Promise<void> {
  await api("/api/todos", { method: "POST", body: JSON.stringify({ title }) });
}
