import { useSyncExternalStore } from "react";
import { cx } from "./class-names.ts";
import { getToasts, subscribe, type ToastTone } from "./toaster-store.ts";
import "./toaster.css";

// Same semantics as Alert: warning/error interrupt, the rest are polite.
const TOAST_ROLES: Record<ToastTone, "alert" | "status"> = {
  info: "status",
  success: "status",
  warning: "alert",
  error: "alert",
};

/**
 * Renders the queued toasts in a fixed corner region. getToasts doubles as the server
 * snapshot: a static render shows the toasts that were queued before it, and both snapshots
 * return the same stable array, so hydration cannot tear.
 */
export function Toaster() {
  const toasts = useSyncExternalStore(subscribe, getToasts, getToasts);

  return (
    <div className="fc-toaster">
      {toasts.map((item) => (
        <div
          key={item.id}
          role={TOAST_ROLES[item.tone]}
          className={cx("fc-toast", "fc-toast--" + item.tone)}
        >
          {item.message}
        </div>
      ))}
    </div>
  );
}
