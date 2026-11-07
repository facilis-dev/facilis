// Create a reusable view from the console's last query (D-097). The request creates the
// view in the running database first; only then is the generated `defineView` module written
// through the kernel VFS, so a failed request never leaves half a feature behind.

import { useEffect, useState } from "react";
import { toast } from "sonner";
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
import { createDevView, type DevQueryColumn } from "@/facilis/dev-query-client";
import {
  buildViewSource,
  isValidViewName,
  validateViewColumns,
  viewSlug,
} from "@/facilis/view-codegen";
import { errText } from "@/vv/errors";
import { useIde } from "./useIde";

interface CreateFailure {
  readonly code: string;
  readonly error: string;
  readonly message?: string;
  readonly path?: string;
}

function failureMessage(failure: CreateFailure): string {
  switch (failure.code) {
    case "invalid_name":
      return t("dataQuery.create.error.invalidName");
    case "invalid_sql":
      return t("dataQuery.create.error.invalidSql");
    case "create_failed":
      return t("dataQuery.create.error.failed");
    case "invalid_permission":
      return t("dataQuery.create.error.invalidPermission");
    case "write_failed":
      return t("dataQuery.writeFailed", { path: failure.path ?? "", error: failure.error });
    default:
      return t("dataQuery.create.error.generic", { error: failure.error });
  }
}

export function DataQueryCreateViewDialog({
  open,
  onOpenChange,
  base,
  columns,
  query,
  permissions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  base: string | null;
  columns: readonly DevQueryColumn[];
  query: string;
  permissions: readonly string[];
}) {
  const { c } = useIde();
  const root = c.activeFolder?.rootPath ?? null;
  const [name, setName] = useState("");
  const [permission, setPermission] = useState("");
  const [creating, setCreating] = useState(false);
  const [failure, setFailure] = useState<CreateFailure | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setPermission("");
    setFailure(null);
    setCreating(false);
  }, [open]);

  const nameValid = isValidViewName(name);
  const columnsError = validateViewColumns(columns);
  const permissionValid = permission === "" || permissions.includes(permission);
  const canSubmit =
    base !== null &&
    root !== null &&
    nameValid &&
    permissionValid &&
    columnsError === null &&
    !creating;
  const path = t("dataQuery.createPath", {
    slug: nameValid ? viewSlug(name) : "…",
  });

  const submit = async () => {
    if (!canSubmit || base === null || root === null) return;
    setCreating(true);
    setFailure(null);
    const created = await createDevView(base, name, query, {
      permission: permission === "" ? undefined : permission,
    });
    if (!created.ok) {
      setFailure({
        code: created.code ?? "create_failed",
        error: created.error,
        ...(created.message === undefined ? {} : { message: created.message }),
      });
      setCreating(false);
      return;
    }
    try {
      const source = buildViewSource({
        name,
        columns,
        query,
        ...(permission === "" ? {} : { permission }),
      });
      const reply = await c.bridge.request("vv-write", {
        path: root + "/" + source.path,
        contents: source.contents,
      });
      if (reply.ok !== true) {
        throw new Error(typeof reply.error === "string" ? reply.error : "vv-write failed");
      }
      toast.success(t("dataQuery.viewCreated", { name: created.name, path: source.path }));
      onOpenChange(false);
    } catch (error) {
      setFailure({ code: "write_failed", error: errText(error), path });
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!creating) onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg" showCloseButton={!creating}>
        <DialogHeader>
          <DialogTitle>{t("dataQuery.create.title")}</DialogTitle>
          <DialogDescription>{t("dataQuery.create.description", { path })}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {t("dataQuery.create.nameLabel")}
            </span>
            <Input
              autoFocus
              data-testid="data-query-create-name"
              value={name}
              placeholder={t("dataQuery.create.namePlaceholder")}
              aria-invalid={name.length > 0 && !nameValid}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void submit();
              }}
            />
            <span className="text-[10px] text-muted-foreground">
              {t("dataQuery.create.nameHint")}
            </span>
            {name.length > 0 && !nameValid && (
              <span className="text-[10px] text-destructive">
                {t("dataQuery.create.nameInvalid")}
              </span>
            )}
            {columnsError !== null && (
              <span className="text-[10px] text-destructive">
                {t("dataQuery.create.columnsInvalid")}
              </span>
            )}
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {t("dataQuery.create.permissionLabel")}
            </span>
            <select
              data-testid="data-query-create-permission"
              value={permission}
              onChange={(event) => setPermission(event.target.value)}
              className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option value="">{t("dataQuery.create.permissionNone")}</option>
              {permissions.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
            <span className="text-[10px] text-muted-foreground">
              {t("dataQuery.create.permissionHint")}
            </span>
          </label>
          {permission === "" ? (
            <p className="rounded-md border border-warning/40 bg-warning/5 px-2 py-1.5 text-[11px] text-warning">
              {t("dataQuery.create.rlsNote")}
            </p>
          ) : (
            <p className="rounded-md border border-warning/40 bg-warning/5 px-2 py-1.5 text-[11px] text-warning">
              {t("dataQuery.create.permissionNote", { permission })}
            </p>
          )}
          {failure !== null && (
            <div
              data-testid="data-query-view-error"
              className="space-y-0.5 text-xs text-destructive"
            >
              <p>{failureMessage(failure)}</p>
              <p className="font-mono text-[10px] text-muted-foreground">
                {failure.code ?? ""}
                {failure.message === undefined ? "" : " · " + failure.message}
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={creating}>
            {t("common.cancel")}
          </Button>
          <Button
            data-testid="data-query-create-submit"
            onClick={() => void submit()}
            disabled={!canSubmit}
          >
            {creating ? t("dataQuery.create.creating") : t("dataQuery.create.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
