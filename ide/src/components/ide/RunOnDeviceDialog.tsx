// The run gate for a device that should not install + start a dev server unprompted
// (run-consent.ts). Rendered from the shell so it is reachable from every run entry
// point: the Run controls, Create with "Install and run", and the ?project= tab boot.
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { t } from "@/i18n";
import {
  declineRunConsent,
  getPendingRun,
  grantRunConsent,
  subscribeRunConsent,
} from "@/vv/run-consent";
import { useIde } from "./useIde";

export function RunOnDeviceDialog() {
  const { c } = useIde();
  const pending = useSyncExternalStore(subscribeRunConsent, getPendingRun);
  // Grant first, then run: the controller asks again, and the grant is what makes the
  // second pass start instead of re-parking the request.
  const confirm = () => {
    const root = grantRunConsent();
    if (root !== null) c.runProject(root);
  };
  return (
    <Dialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) declineRunConsent();
      }}
    >
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t("run.confirm.title")}</DialogTitle>
          <DialogDescription>{t("run.confirm.body")}</DialogDescription>
        </DialogHeader>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
          <li>{t("run.confirm.costInstall")}</li>
          <li>{t("run.confirm.costMemory")}</li>
          <li>{t("run.confirm.costTime")}</li>
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={() => declineRunConsent()}>
            {t("run.confirm.notNow")}
          </Button>
          <Button onClick={confirm}>{t("run.confirm.start")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
