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
import { t } from "@/i18n";
import { DEFAULT_TEMPLATE_KEY, type TemplateKey } from "@/facilis/templates";
import { scaffoldUi } from "@/vv/scaffold-ui";
import { useIde } from "./useIde";
import { TemplatePicker } from "./TemplatePicker";

/**
 * Picking the template for an empty (or README-only) clone (D-080). The clone toast and
 * the palette command used to scaffold the default template unseen; this dialog is what
 * they open instead, so the choice is always the user's.
 */
export function ScaffoldTemplateDialog() {
  const { c } = useIde();
  const { open, root } = useSyncExternalStore(scaffoldUi.subscribe, scaffoldUi.getSnapshot);
  const [template, setTemplate] = useState<TemplateKey>(DEFAULT_TEMPLATE_KEY);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTemplate(DEFAULT_TEMPLATE_KEY);
    setBusy(false);
  }, [open]);

  if (!open || root === null) return null;

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    const ok = await c.projectImport.scaffoldFolder(root, template);
    // A failure toasts its reason from the service; keeping the dialog open lets the
    // user retry (another template, or the same one once the kernel is ready).
    if (ok) scaffoldUi.close();
    else setBusy(false);
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        // Scaffolding is not cancellable once the write starts, so every close route
        // (Cancel, Escape, click-outside, the header X) is refused while busy.
        if (!next && !busy) scaffoldUi.close();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("scaffoldDialog.title")}</DialogTitle>
          <DialogDescription>{t("scaffoldDialog.description")}</DialogDescription>
        </DialogHeader>
        <TemplatePicker value={template} onChange={setTemplate} />
        <DialogFooter>
          <Button variant="outline" onClick={() => scaffoldUi.close()} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? t("create.creating") : t("scaffoldDialog.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
