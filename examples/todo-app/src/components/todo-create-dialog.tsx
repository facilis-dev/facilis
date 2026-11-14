import { useEffect, useState, type FormEvent } from "react";
import { t } from "@facilis.dev/core/i18n";
import { Button } from "./ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog.tsx";
import { Field } from "./ui/field.tsx";
import { Input } from "./ui/input.tsx";

export type TodoDraft = { title: string; dueDate: Date | null };

/** The date input's "YYYY-MM-DD" is a local calendar day: parse it as local midnight. */
function dateFromInput(value: string): Date | null {
  return value === "" ? null : new Date(value + "T00:00:00");
}

export type TodoCreateDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  creating: boolean;
  onCreate: (draft: TodoDraft) => Promise<boolean>;
};

/** Create flow P-01: the header's "New todo" opens this dialog; a saved todo closes it. */
export function TodoCreateDialog({
  open,
  onOpenChange,
  creating,
  onCreate,
}: TodoCreateDialogProps) {
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");

  // Opening starts from a clean form: a cancelled draft never leaks into the next open.
  useEffect(() => {
    if (!open) return;
    setTitle("");
    setDueDate("");
  }, [open]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = title.trim();
    if (trimmed.length === 0) return;
    const saved = await onCreate({ title: trimmed, dueDate: dateFromInput(dueDate) });
    if (saved) onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>{t("todos.new")}</DialogTitle>
          <DialogDescription>{t("todos.form.description")}</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={(event) => void handleSubmit(event)}>
          <Field label={t("todos.column.title")}>
            <Input
              autoFocus
              type="text"
              placeholder={t("todos.title.placeholder")}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>
          <Field label={t("todos.dueDate")}>
            <Input
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={creating || title.trim().length === 0}>
              {t("todos.add")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
