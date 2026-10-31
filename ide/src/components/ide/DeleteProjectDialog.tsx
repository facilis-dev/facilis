// Delete a project for good: files first, then the registry entry.
//
// The old row action only dropped the project from Home's recent list, so the files stayed
// on OPFS and the button read as a delete that did not delete (D-050). Because the action is
// irreversible it asks for the project's name, not a click: the dialog's confirm button
// stays disabled until the typed text matches the folder's name exactly.
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";
import { confirmsProjectName, projectName } from "@/vv/project-name";
import { useIde } from "./useIde";

export function DeleteProjectDialog({
  open,
  onOpenChange,
  rootPath,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rootPath: string;
}) {
  const { c } = useIde();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const name = projectName(rootPath);
  const confirmed = confirmsProjectName(rootPath, typed);

  useEffect(() => {
    if (open) {
      setTyped("");
      setBusy(false);
    }
  }, [open]);

  const remove = async () => {
    if (!confirmed || busy) return;
    setBusy(true);
    if (await c.deleteProject(rootPath)) onOpenChange(false);
    setBusy(false);
  };

  return (
    // While the delete is in flight the dialog is not dismissable: the kernel request
    // cannot be cancelled, so closing it would only hide a delete that still happens.
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!busy) onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-md" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>{t("delete.title", { name })}</DialogTitle>
          <DialogDescription>{t("delete.body")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="break-all rounded-md border bg-muted/40 px-2 py-1.5 font-mono text-xs text-muted-foreground">
            {rootPath}
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {t("delete.confirmLabel")}
            </span>
            <Input
              autoFocus
              value={typed}
              placeholder={name}
              aria-invalid={typed.length > 0 && !confirmed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void remove();
              }}
            />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button variant="destructive" onClick={() => void remove()} disabled={!confirmed || busy}>
            {busy ? t("delete.deleting") : t("delete.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
