// "Reset everything" is an irreversible wipe of the whole origin — files, dependency
// cache and the recent-projects list — so it never fires from a click or a browser
// confirm(): Home and the command palette both open this dialog, which stays locked
// until the user types the confirmation word (the typed-confirmation policy of D-050,
// applied origin-wide in D-189). Store-driven (reset-ui.ts) so Home and the palette
// share the one dialog.
import { useEffect, useState, useSyncExternalStore } from "react";
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
import { RESET_CONFIRMATION, confirmsResetEverything } from "@/vv/reset-confirmation";
import { resetUi } from "@/vv/reset-ui";
import { useIde } from "./useIde";

export function ResetEverythingDialog() {
  const { c } = useIde();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const open = useSyncExternalStore(resetUi.subscribe, resetUi.getSnapshot);
  const confirmed = confirmsResetEverything(typed);

  useEffect(() => {
    if (open) {
      setTyped("");
      setBusy(false);
    }
  }, [open]);

  const confirmReset = async () => {
    if (!confirmed || busy) return;
    setBusy(true);
    // resetEverything() tears down the worker, wipes OPFS, and reloads the page,
    // so control does not return here on success.
    await c.resetEverything();
  };

  return (
    // While the reset is running, lock the dialog: ignore open-state changes and
    // disable backdrop/Escape dismissal + the X so the destructive op can't be
    // interrupted mid-flight (the page reloads on success).
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !busy) resetUi.close();
      }}
    >
      <DialogContent className="sm:max-w-md" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>{t("reset.title")}</DialogTitle>
          <DialogDescription>{t("reset.body")}</DialogDescription>
        </DialogHeader>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            {t("reset.confirmLabel", { word: RESET_CONFIRMATION })}
          </span>
          <Input
            autoFocus
            value={typed}
            placeholder={RESET_CONFIRMATION}
            aria-invalid={typed.length > 0 && !confirmed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void confirmReset();
            }}
          />
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={() => resetUi.close()} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="destructive"
            onClick={() => void confirmReset()}
            disabled={!confirmed || busy}
          >
            {busy ? t("reset.busy") : t("reset.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
