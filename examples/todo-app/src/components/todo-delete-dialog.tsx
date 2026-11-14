import { t } from "@facilis.dev/core/i18n";
import type { Todo } from "./todo-table.tsx";
import { Button } from "./ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog.tsx";

export type TodoDeleteDialogProps = {
  /** The row waiting for confirmation, or null. */
  todo: Todo | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

/** P-04: the confirmation names the record and the button carries the destructive verb. */
export function TodoDeleteDialog({ todo, busy, onCancel, onConfirm }: TodoDeleteDialogProps) {
  return (
    <Dialog
      open={todo !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>{t("todos.delete.title")}</DialogTitle>
          <DialogDescription>
            {todo === null ? null : t("todos.delete.description", { title: todo.title })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button variant="destructive" disabled={busy} onClick={onConfirm}>
            {t("todos.delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
