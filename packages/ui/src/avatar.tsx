import { cx } from "./class-names.ts";
import "./avatar.css";

export type AvatarSize = "sm" | "md" | "lg";

export type AvatarProps = {
  name: string;
  size?: AvatarSize;
  className?: string;
};

export type AvatarStackProps = {
  names: readonly string[];
  /** How many avatars to show before the +N chip. */
  max?: number;
  className?: string;
};

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1] ?? "") : "";
  return (first.charAt(0) + last.charAt(0)).toUpperCase();
}

/** Deterministic tint index: the same person keeps the same avatar colour everywhere. */
function toneOf(name: string): number {
  let hash = 0;
  for (const char of name) hash = (hash + (char.codePointAt(0) ?? 0)) % 5;
  return hash;
}

/** Initial-based avatar; the tint is derived from the name, never passed as a colour. */
export function Avatar({ name, size = "md", className }: AvatarProps) {
  return (
    <span
      className={cx("fc-avatar", size === "md" ? undefined : "fc-avatar--" + size, className)}
      data-tone={toneOf(name)}
      role="img"
      aria-label={name}
      title={name}
    >
      {initialsOf(name)}
    </span>
  );
}

/** Overlapping avatar row with a +N chip for the people who did not fit. */
export function AvatarStack({ names, max = 3, className }: AvatarStackProps) {
  const shown = names.slice(0, max);
  const extra = names.length - shown.length;

  return (
    <span className={cx("fc-avatar-stack", className)}>
      {shown.map((name) => (
        <Avatar key={name} name={name} size="sm" />
      ))}
      {extra > 0 ? (
        <span className="fc-avatar fc-avatar--sm fc-avatar--more" aria-hidden="true">
          +{extra}
        </span>
      ) : null}
    </span>
  );
}
