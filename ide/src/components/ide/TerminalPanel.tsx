import { useEffect, useRef } from "react";
import Plus from "~icons/lucide/plus";
import Trash2 from "~icons/lucide/trash-2";
import ChevronDown from "~icons/lucide/chevron-down";
import ExternalLink from "~icons/lucide/external-link";
import SquareTerminal from "~icons/lucide/square-terminal";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { useIde } from "./useIde";

export function TerminalPanel() {
  const { c, snap } = useIde();
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const visibleTermId =
    snap.panelTab === "console"
      ? "console"
      : snap.panelTab === "terminal"
        ? snap.activeTermId
        : null;

  // Fit the visible terminal whenever the panel resizes or the visible tab/term changes.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => c.fitTerminal(visibleTermId));
    ro.observe(el);
    return () => ro.disconnect();
  }, [c, visibleTermId]);

  useEffect(() => {
    c.fitTerminal(visibleTermId);
  }, [c, visibleTermId]);

  const shells = snap.terminals.filter((t) => t.kind === "shell");
  // The panel has no tab strip any more: the status bar's chips pick the surface
  // (D-124), so this bar only names it and carries the panel's own actions.
  const title =
    snap.panelTab === "console"
      ? t("panel.console")
      : snap.panelTab === "terminal"
        ? t("panel.terminal")
        : t("panel.ports");

  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b px-2 pr-1">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </span>
        <span className="flex-1" />
        {snap.panelTab === "terminal" && (
          <button
            title={t("panel.newTerminal")}
            aria-label={t("panel.newTerminal")}
            className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => c.terminals.newShellTerminal()}
          >
            <Plus className="size-4" />
          </button>
        )}
        <button
          title={t("panel.hide")}
          aria-label={t("panel.hide")}
          className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={() => c.togglePanel(false)}
        >
          <ChevronDown className="size-4" />
        </button>
      </div>

      {/* body — all xterm hosts stay mounted so scrollback survives surface switches */}
      <div ref={bodyRef} className="relative flex-1 overflow-hidden">
        {/* Console */}
        <div className={cn("absolute inset-0", snap.panelTab === "console" ? "block" : "hidden")}>
          <div
            className="vv-term-host absolute inset-0"
            ref={(el) => c.mountTerminal("console", el)}
          />
        </div>

        {/* Terminal: xterm on the left, terminal list on the right (resizable) */}
        <div className={cn("absolute inset-0", snap.panelTab === "terminal" ? "block" : "hidden")}>
          <ResizablePanelGroup orientation="horizontal">
            <ResizablePanel
              id="term-content"
              defaultSize="80%"
              minSize="30%"
              // Refit the visible xterm whenever the split is dragged.
              onResize={() => c.fitTerminal(visibleTermId)}
            >
              <div className="relative h-full min-w-0">
                {shells.length === 0 && (
                  <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
                    {t("panel.noTerminals")}
                  </div>
                )}
                {shells.map((term) => (
                  <div
                    key={term.id}
                    className={cn(
                      "vv-term-host absolute inset-0",
                      snap.panelTab === "terminal" && term.id === snap.activeTermId
                        ? "block"
                        : "hidden",
                    )}
                    ref={(el) => c.mountTerminal(term.id, el)}
                  />
                ))}
              </div>
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel id="term-list" defaultSize="20%" minSize="10%" maxSize="45%">
              <ul className="h-full overflow-y-auto border-l bg-sidebar py-1 text-xs">
                {shells.map((term) => {
                  const active = term.id === snap.activeTermId;
                  return (
                    <li key={term.id}>
                      <div
                        onClick={() => c.terminals.switchTerminal(term.id)}
                        className={cn(
                          "group flex cursor-pointer items-center gap-1.5 px-2 py-1",
                          active
                            ? "bg-accent text-foreground"
                            : "text-muted-foreground hover:text-foreground",
                          !term.alive && "italic opacity-60",
                        )}
                      >
                        <SquareTerminal className="size-3.5 shrink-0 opacity-70" />
                        <span className="truncate">{term.label}</span>
                        <button
                          title={t("panel.killTerminal")}
                          aria-label={t("panel.killTerminal")}
                          className="ml-auto hidden size-4 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground group-hover:flex"
                          onClick={(e) => {
                            e.stopPropagation();
                            c.terminals.closeTerminal(term.id);
                          }}
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>

        {/* Ports */}
        <div
          className={cn(
            "absolute inset-0 overflow-auto",
            snap.panelTab === "ports" ? "block" : "hidden",
          )}
        >
          {snap.ports.length === 0 ? (
            <div className="flex h-full items-center justify-center px-6 text-center text-xs text-muted-foreground">
              {t("panel.noPorts")}
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr className="border-b">
                  <th className="px-3 py-1.5 text-left font-medium">{t("panel.port")}</th>
                  <th className="px-3 py-1.5 text-left font-medium">{t("panel.process")}</th>
                  <th className="px-3 py-1.5 text-left font-medium">{t("panel.address")}</th>
                  <th className="px-3 py-1.5 text-right font-medium" />
                </tr>
              </thead>
              <tbody>
                {snap.ports.map((p) => (
                  <tr key={p.port} className="border-b border-border/50 hover:bg-accent/40">
                    <td className="px-3 py-1.5 font-mono text-foreground">{p.port}</td>
                    <td className="px-3 py-1.5 font-mono text-muted-foreground">{p.pid}</td>
                    <td className="px-3 py-1.5 font-mono text-muted-foreground">
                      localhost:{p.port}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <button
                        title={t("panel.openPreview")}
                        aria-label={t("panel.openPreview")}
                        className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                        onClick={() => c.preview.openExternalPreview(p.port)}
                      >
                        <ExternalLink className="size-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
