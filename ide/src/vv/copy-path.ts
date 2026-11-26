// Copying an absolute path, with its two failure modes in one place: the status bar is
// where the result lands, and the clipboard may be unavailable. Split out of
// controller.ts so that file stays under its line ratchet.
import { toast } from "sonner";

export function copyPathToClipboard(abs: string, report: (text: string) => void): void {
  try {
    void navigator.clipboard?.writeText(abs);
    report(`copied path: ${abs}`);
  } catch {
    toast.error("Clipboard unavailable");
  }
}
