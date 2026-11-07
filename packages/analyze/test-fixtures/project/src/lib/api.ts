export async function api(path: string, init: RequestInit = {}): Promise<unknown> {
  return fetch(path, init);
}
