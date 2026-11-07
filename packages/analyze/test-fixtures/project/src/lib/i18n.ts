export function label(key: string): string {
  return t(key);
}

export const title = t("todos.title");
export const empty = t(`todos.empty`);
export const interpolated = t(`todos.${title}`);
export const conditional = t(label("todos.conditional"));
