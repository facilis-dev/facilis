// How a path renders: in the image viewer, as a notebook, or in Monaco.
// Split out of controller.ts so the tab/editor logic there can import it without
// carrying the extension tables.

// Extensions we render in the image viewer instead of the text editor. SVG is
// grouped here too (it's an image); flip it to text if you'd rather edit it.
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "avif", "svg"]);
export function isImagePath(path: string): boolean {
  const dot = path.lastIndexOf(".");
  return dot > 0 && IMAGE_EXTS.has(path.slice(dot + 1).toLowerCase());
}
/** Files that open as a notebook rather than as their JSON. */
export function isNotebookPath(path: string): boolean {
  return path.toLowerCase().endsWith(".ipynb");
}
// The MIME type for an image path, so the viewer's Blob renders correctly.
export function imageMime(path: string): string {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  if (ext === "svg") return "image/svg+xml";
  if (ext === "jpg") return "image/jpeg";
  if (ext === "ico") return "image/x-icon";
  return "image/" + ext;
}
