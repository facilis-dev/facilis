import { useState, type FormEvent, type RefObject } from "react";
import { t } from "@facilis/core/i18n";
import { Button } from "./ui/button.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card.tsx";
import { Field } from "./ui/field.tsx";
import { Input } from "./ui/input.tsx";

export type TodoDraft = { title: string; dueDate: Date | null };

export type TodoFormProps = {
  canWrite: boolean;
  creating: boolean;
  titleInput: RefObject<HTMLInputElement | null>;
  onCreate: (draft: TodoDraft) => Promise<boolean>;
};

/** The date input's "YYYY-MM-DD" is a local calendar day: parse it as local midnight. */
function dateFromInput(value: string): Date | null {
  return value === "" ? null : new Date(value + "T00:00:00");
}

/** Create form as an A card: title + optional due date, cleared only after a saved todo. */
export function TodoForm({ canWrite, creating, titleInput, onCreate }: TodoFormProps) {
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = title.trim();
    if (trimmed.length === 0) return;
    const saved = await onCreate({ title: trimmed, dueDate: dateFromInput(dueDate) });
    if (saved) {
      setTitle("");
      setDueDate("");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("todos.new")}</CardTitle>
        <CardDescription>{t("todos.form.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-end"
          onSubmit={(event) => void handleSubmit(event)}
        >
          <Field label={t("todos.column.title")} className="min-w-0 flex-1">
            <Input
              ref={titleInput}
              type="text"
              placeholder={t("todos.title.placeholder")}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>
          <Field label={t("todos.dueDate")} className="sm:w-44">
            <Input
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
            />
          </Field>
          <Button type="submit" disabled={!canWrite || creating || title.trim().length === 0}>
            {t("todos.add")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
