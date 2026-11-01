import { cx } from "./class-names.ts";
import "./switch.css";

export type SwitchProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Accessible name; the visible label usually lives next to the control. */
  label: string;
  disabled?: boolean;
  className?: string;
};

/** Token-only toggle: a pill track whose state is exposed through aria-checked. */
export function Switch({ checked, onChange, label, disabled, className }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={cx("fc-switch", className)}
      onClick={() => onChange(!checked)}
    >
      <span className="fc-switch__thumb" />
    </button>
  );
}
