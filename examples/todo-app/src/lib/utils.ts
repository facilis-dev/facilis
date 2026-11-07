import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Conditional class names with Tailwind conflicts resolved: the shadcn `cn` helper. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
