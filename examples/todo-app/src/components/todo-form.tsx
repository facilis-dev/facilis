import { useState, type FormEvent, type RefObject } from "react";
import { Button, Card, DatePicker, Field, Input } from "@facilis/ui";
import { t } from "@facilis/core/i18n";
import { useLocale } from "../lib/i18n.tsx";

export type TodoDraft = { title: string; dueDate: Date | null };

export type TodoFormProps = {
  canWrite: boolean;
  creating: boolean;
  titleInput: RefObject<HTMLInputElement | null>;
  onCreate: (draft: TodoDraft) => Promise<boolean>;
};

/** Create form as an A card: title + optional due date, cleared only after a saved todo. */
export function TodoForm({ canWrite, creating, titleInput, onCreate }: TodoFormProps) {
  const { locale } = useLocale();
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState<Date | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = title.trim();
    if (trimmed.length === 0) return;
    const saved = await onCreate({ title: trimmed, dueDate });
    if (saved) {
      setTitle("");
      setDueDate(null);
    }
  }

  return (
    <Card title={t("todos.new")} description={t("todos.form.description")}>
      <form className="app-todos-form" onSubmit={(event) => void handleSubmit(event)}>
        <Field label={t("todos.column.title")} className="app-todos-form__title">
          <Input
            ref={titleInput}
            type="text"
            placeholder={t("todos.title.placeholder")}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <Field label={t("todos.dueDate")} className="app-todos-form__date">
          <DatePicker
            value={dueDate}
            onChange={setDueDate}
            locale={locale}
            labels={{
              previousMonth: t("datepicker.previous_month"),
              nextMonth: t("datepicker.next_month"),
              today: t("datepicker.today"),
              clear: t("datepicker.clear"),
              chooseTime: t("datepicker.choose_time"),
              calendarLabel: t("datepicker.calendar"),
              hoursLabel: t("datepicker.hours"),
              minutesLabel: t("datepicker.minutes"),
            }}
          />
        </Field>
        <Button type="submit" disabled={!canWrite || creating || title.trim().length === 0}>
          {t("todos.add")}
        </Button>
      </form>
    </Card>
  );
}
