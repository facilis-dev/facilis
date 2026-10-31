// Pure path helpers shared by the controller and the modules it is split into. Paths are
// absolute VFS paths: no trailing slash, "/" between segments.

export const baseName = (p: string) => p.split("/").filter(Boolean).pop() ?? p;
export const parentOf = (p: string) => p.slice(0, p.lastIndexOf("/")) || "/";

export const normDir = (p: string) => {
  const n =
    "/" +
    p
      .split("/")
      .filter((s) => s && s !== ".")
      .join("/");
  return n === "/" ? "/" : n.replace(/\/+$/, "");
};
