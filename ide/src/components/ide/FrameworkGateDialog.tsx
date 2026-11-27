// The D-198 boot gate's blocking prompt: a project with below-minimum @facilis.dev/*
// pins cannot start until the user explicitly updates them (or declines and stays
// unbooted). Reads the gate's external store; the update action runs the D-070 upgrade
// engine with an npm-install postflight (framework-gate.ts).

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
import {
  acceptFrameworkUpdate,
  declineFrameworkUpdate,
  dismissFrameworkGate,
  getFrameworkGate,
  subscribeFrameworkGate,
} from "@/facilis/framework-gate";
import { t } from "@/i18n";
import { BusyStatus } from "./BusyStatus";
import { FormError } from "./FormError";

export function FrameworkGateDialog() {
  const gate = useSyncExternalStore(subscribeFrameworkGate, getFrameworkGate);
  if (gate === null) return null;
  const busy = gate.phase === "applying";
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        // Esc/backdrop is a decline while prompting, and a plain close on error; never
        // interrupts an apply in flight (the engine must finish or roll back).
        if (!open && !busy) {
          if (gate.phase === "error") dismissFrameworkGate();
          else declineFrameworkUpdate();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("updates.framework.blockedTitle")}</DialogTitle>
          <DialogDescription>{t("updates.framework.blockedDescription")}</DialogDescription>
        </DialogHeader>
        <ul className="space-y-1">
          {gate.below.map((pin) => (
            <li key={pin.name} className="font-mono text-xs text-muted-foreground">
              {t("updates.framework.belowRow", {
                name: pin.name,
                pinned: pin.pinned,
                minimum: pin.minimum,
              })}
            </li>
          ))}
        </ul>
        {gate.phase === "error" && gate.error !== null && (
          <FormError live className="text-sm">
            {gate.error}
          </FormError>
        )}
        {busy && <BusyStatus className="text-sm">{t("updates.framework.applying")}</BusyStatus>}
        <DialogFooter>
          {gate.phase === "error" ? (
            <>
              <Button variant="outline" onClick={dismissFrameworkGate}>
                {t("updates.framework.close")}
              </Button>
              <Button onClick={() => void acceptFrameworkUpdate()}>
                {t("updates.framework.retry")}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" disabled={busy} onClick={declineFrameworkUpdate}>
                {t("updates.framework.decline")}
              </Button>
              <Button disabled={busy} onClick={() => void acceptFrameworkUpdate()}>
                {t("updates.framework.update")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
