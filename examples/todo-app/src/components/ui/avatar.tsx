import { cn } from "../../lib/utils.ts";

export type AvatarSize = "sm" | "md" | "lg";

export type AvatarProps = { name: string; size?: AvatarSize; className?: string };

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1] ?? "") : "";
  return (first.charAt(0) + last.charAt(0)).toUpperCase();
}

/** Initial-based avatar: the shell passes a display name, never a colour. */
export function Avatar({ name, size = "md", className }: AvatarProps) {
  const sizing =
    size === "sm" ? "size-7 text-xs" : size === "lg" ? "size-10 text-base" : "size-8 text-sm";
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-secondary font-medium text-secondary-foreground select-none",
        sizing,
        className,
      )}
      role="img"
      aria-label={name}
      title={name}
    >
      {initialsOf(name)}
    </span>
  );
}
