/**
 * Framework-agnostic toast store.
 *
 * It lives outside toaster.tsx so the fixed 4 s dismissal can be tested with fake timers
 * without rendering React. The public contract exposes only toast(); pushToast stays
 * module-level so tests can seed the store before a server render.
 */

export type ToastTone = "info" | "success" | "warning" | "error";

export type ToastItem = {
  readonly id: number;
  readonly message: string;
  readonly tone: ToastTone;
};

const DISMISS_MS = 4_000;
// A stable empty snapshot: useSyncExternalStore requires the same reference between changes.
const EMPTY: readonly ToastItem[] = [];

let toasts: readonly ToastItem[] = EMPTY;
let nextId = 1;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function removeToast(id: number): void {
  toasts = toasts.filter((item) => item.id !== id);
  notify();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getToasts(): readonly ToastItem[] {
  return toasts;
}

/** Queues one toast and schedules its dismissal exactly four seconds later. */
export function pushToast(tone: ToastTone, message: string): number {
  const id = nextId;
  nextId += 1;
  toasts = [...toasts, { id, message, tone }];
  notify();
  setTimeout(() => removeToast(id), DISMISS_MS);
  return id;
}

type ToastMethod = (message: string) => void;

export type ToastApi = ToastMethod & {
  info: ToastMethod;
  success: ToastMethod;
  warning: ToastMethod;
  error: ToastMethod;
};

/**
 * The public helper: toast(message) is an info toast, the methods pick a tone. There are no
 * options on purpose — the 4 s lifetime is the contract, not a per-call setting (D-047).
 */
export const toast: ToastApi = Object.assign(
  (message: string) => {
    pushToast("info", message);
  },
  {
    info: (message: string) => {
      pushToast("info", message);
    },
    success: (message: string) => {
      pushToast("success", message);
    },
    warning: (message: string) => {
      pushToast("warning", message);
    },
    error: (message: string) => {
      pushToast("error", message);
    },
  },
);
