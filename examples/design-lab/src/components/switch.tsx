export type SwitchProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Accessible name; the visible label lives next to the control in the surrounding row. */
  label: string;
  disabled?: boolean;
};

/** Token-only toggle: a pill track with a thumb that moves, no colour literals. */
export function Switch({ checked, onChange, label, disabled }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={"lab-switch" + (checked ? " lab-switch--on" : "")}
      onClick={() => onChange(!checked)}
    >
      <span className="lab-switch__thumb" />
    </button>
  );
}
