export async function load(): Promise<unknown> {
  return fetch("/api/todos");
}
