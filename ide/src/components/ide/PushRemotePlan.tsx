import Loader from "~icons/lucide/loader-circle";
import { t } from "@/i18n";
import { BusyStatus } from "./BusyStatus";

/** The preflight summary: what a publish would change and where it lands. */
export function PushRemotePlan(props: { changes: number; summary: string; target: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border p-3 text-sm">
      {props.changes > 0 && <div>{props.summary}</div>}
      {props.changes > 0 && <div className="text-xs text-muted-foreground">{props.target}</div>}
      {props.changes === 0 && <div className="text-muted-foreground">{t("push.clean")}</div>}
    </div>
  );
}

/** The publish layer's current phase, with the counts it reports. */
export function PushRemoteProgress(props: { text: string; busy: boolean }) {
  return (
    <BusyStatus className="flex items-center gap-2">
      {props.busy && <Loader className="size-3.5 animate-spin" />}
      <span className="truncate">{props.text}</span>
    </BusyStatus>
  );
}
