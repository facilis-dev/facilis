import { useEffect, useState } from "react";
import Github from "~icons/lucide/github";
import Package from "~icons/lucide/package";
import Loader from "~icons/lucide/loader-circle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIde } from "./useIde";
import { t } from "@/i18n";

type Source = "github" | "npm";

// Import a project from a public GitHub repo or an npm package. Snapshot-driven
// (c.openImportRemote / c.closeImportRemote) so it works from Home and the
// command palette alike.
export function ImportRemoteDialog() {
  const { c, snap } = useIde();
  const open = snap.importRemoteOpen;
  const [tab, setTab] = useState<Source>("github");
  const [gh, setGh] = useState("");
  const [npm, setNpm] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");

  useEffect(() => {
    if (open) {
      setBusy(false);
      setProgress("");
    }
  }, [open]);

  const value = tab === "github" ? gh : npm;
  const canSubmit = !!value.trim() && !busy && snap.kernelReady;

  const onProgress = (done: number, total: number, phase: string) => {
    setProgress(total > 0 ? t("import.progress", { phase, done, total }) : phase);
  };

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setProgress(t("import.starting"));
    try {
      const ok =
        tab === "github"
          ? await c.importGithubRepo(gh.trim(), onProgress)
          : await c.importNpmPackage(npm.trim(), onProgress);
      if (ok) c.closeImportRemote();
    } catch (err) {
      setProgress(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !busy) c.closeImportRemote();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("import.title")}</DialogTitle>
          <DialogDescription>{t("import.description")}</DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as Source)}>
          <TabsList variant="line">
            <TabsTrigger value="github">
              <Github className="size-4" /> {t("import.github")}
            </TabsTrigger>
            <TabsTrigger value="npm">
              <Package className="size-4" /> {t("import.npm")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="github" className="mt-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                {t("import.repository")}
              </span>
              <Input
                autoFocus
                value={gh}
                onChange={(e) => setGh(e.target.value)}
                placeholder={t("import.githubPlaceholder")}
                disabled={busy}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submit();
                }}
              />
              <span className="text-xs text-muted-foreground">{t("import.githubHint")}</span>
            </label>
          </TabsContent>

          <TabsContent value="npm" className="mt-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                {t("import.package")}
              </span>
              <Input
                autoFocus
                value={npm}
                onChange={(e) => setNpm(e.target.value)}
                placeholder={t("import.npmPlaceholder")}
                disabled={busy}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submit();
                }}
              />
              <span className="text-xs text-muted-foreground">{t("import.npmHint")}</span>
            </label>
          </TabsContent>
        </Tabs>

        {progress && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {busy && <Loader className="size-3.5 animate-spin" />}
            <span className="truncate">{progress}</span>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => c.closeImportRemote()} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => void submit()} disabled={!canSubmit}>
            {busy && <Loader className="size-4 animate-spin" />} {t("import.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
