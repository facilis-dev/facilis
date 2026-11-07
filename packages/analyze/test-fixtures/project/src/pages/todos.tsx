import { api } from "../lib/api.ts";
import { todoPath } from "../lib/todos.ts";

export async function load(id: string): Promise<void> {
  await api("/api/todos");
  await api(todoPath(id));
}

export async function remove(id: string): Promise<void> {
  await api("/api/todos/" + id, { method: "DELETE" });
}
