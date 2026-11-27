import { Input } from "@/components/ui/input";
import { useFormError } from "./FormError";

/**
 * The typed confirmation both destructive dialogs ask for (D-050). The message explains
 * why the confirm button is still disabled, and is tied to the input it is about (issue
 * #219); the input keeps the tab stop while the operation runs.
 */
export function ConfirmNameField(props: {
  label: string;
  value: string;
  placeholder: string;
  error: string | null;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const feedback = useFormError(props.error);
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">{props.label}</span>
        <Input
          autoFocus
          value={props.value}
          placeholder={props.placeholder}
          {...feedback.controlProps}
          onChange={(event) => props.onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") props.onSubmit();
          }}
        />
      </label>
      {feedback.node}
    </div>
  );
}
