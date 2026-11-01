// The two import cards on Home, gated by the deployment (D-063; MANAGED-DEPLOYMENT §8).
//
// A managed build compiles the import paths out, so the cards do not exist there; the
// open profile shows both as before. Keeping them here rather than in Home lets the gate
// live next to the cards without growing Home, whose size the file-length ratchet pins.

import FolderInput from "~icons/lucide/folder-input";
import Github from "~icons/lucide/github";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";
import { deployment, importAllowed } from "@/deploy/current";
import { useIde } from "./useIde";

// An action card whose click is gated on the kernel being ready. While disabled it
// stays hoverable (aria-disabled rather than the native disabled attribute, which would
// swallow hover events) so a tooltip can explain WHY it's disabled - the project is
// still being restored. The tooltip is only rendered while disabled.
function ImportCard({
  icon: Icon,
  title,
  desc,
  onClick,
  disabled,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            onClick={() => {
              if (!disabled) onClick();
            }}
            aria-disabled={disabled}
            className={cn(
              "group flex flex-col items-start gap-3 rounded-xl border bg-card p-5 text-left transition-colors",
              disabled
                ? "cursor-not-allowed opacity-60"
                : "hover:border-primary/60 hover:bg-accent/40",
            )}
          />
        }
      >
        <div className="flex size-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-6" />
        </div>
        <div>
          <div className="font-medium">{title}</div>
          <div className="text-sm text-muted-foreground">{desc}</div>
        </div>
      </TooltipTrigger>
      {disabled && <TooltipContent>{t("home.importLocked")}</TooltipContent>}
    </Tooltip>
  );
}

/** The import surfaces a deployment allows, or nothing when it allows none. */
export function HomeImportCards() {
  const { c, snap } = useIde();
  const folder = importAllowed(deployment, "folder");
  const remote = importAllowed(deployment, "git") || importAllowed(deployment, "npm");
  if (!folder && !remote) return null;
  return (
    <>
      {folder && (
        <ImportCard
          icon={FolderInput}
          title={t("home.importFolder")}
          desc={t("home.importFolderDesc")}
          onClick={() => c.importFolderViaPicker()}
          disabled={!snap.kernelReady}
        />
      )}
      {remote && (
        <ImportCard
          icon={Github}
          title={t("home.importRemote")}
          desc={t("home.importRemoteDesc")}
          onClick={() => c.openImportRemote()}
          disabled={!snap.kernelReady}
        />
      )}
    </>
  );
}
