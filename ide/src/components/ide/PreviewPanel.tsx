import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";
import ArrowLeft from "~icons/lucide/arrow-left";
import ArrowRight from "~icons/lucide/arrow-right";
import RotateCw from "~icons/lucide/rotate-cw";
import SquareTerminal from "~icons/lucide/square-terminal";
import ExternalLink from "~icons/lucide/external-link";
import Plus from "~icons/lucide/plus";
import Globe from "~icons/lucide/globe";
import Lock from "~icons/lucide/lock";
import X from "~icons/lucide/x";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { t as translate } from "@/i18n";
import { useIde } from "./useIde";
import { navigatePreviewFrame } from "./preview-frame-nav";
import { hasSeparatePreviewOrigin, previewSandbox } from "@/vv/preview-sandbox";
import type { PreviewTab } from "@/vv/controller";
import { PreviewEmptyState, PreviewEmptyTab } from "./PreviewEmptyState";

function ToolButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function tabTitle(tab: PreviewTab) {
  // Prefer the running app's real document.title (reported by the preview shim);
  // fall back to the port while it boots, or "New Tab" for an empty tab.
  if (tab.title) return tab.title;
  return tab.port != null
    ? translate("preview.tabTitle", { port: tab.port })
    : translate("preview.untitledTab");
}

// A single preview iframe. It deliberately starts at `about:blank` and only
// navigates to the real `/preview/<port>/` URL once mounted (imperatively, in an
// effect). On a fresh page load the preview Service Worker may not yet control a
// brand-new iframe whose *first* navigation is a direct in-scope URL — that
// request escapes to the network and the studio's own SPA fallback serves its
// home page inside the frame. Navigating from an already-existing about:blank
// client (which is what the manual address-bar path does) is reliably
// intercepted by the SW, so we do the same for every tab.
function PreviewFrame({
  tab,
  active,
  src,
  colorScheme,
  setFrame,
  onLoad,
}: {
  tab: PreviewTab;
  active: boolean;
  src: string;
  colorScheme: "light" | "dark";
  setFrame: (id: string, el: HTMLIFrameElement | null) => void;
  onLoad: (id: string) => void;
}) {
  const ref = useRef<HTMLIFrameElement | null>(null);
  const lastSrc = useRef<string | null>(null);

  useEffect(() => {
    void navigatePreviewFrame(ref.current, src, lastSrc);
  }, [src]);

  return (
    <iframe
      ref={(el) => {
        ref.current = el;
        setFrame(tab.id, el);
      }}
      // Fires on every full document (re)load — re-run the DevTools attach
      // handshake so an open panel reconnects after a preview reload/navigation.
      onLoad={() => onLoad(tab.id)}
      title={tabTitle(tab)}
      className={cn("absolute inset-0 h-full w-full border-0", active ? "block" : "hidden")}
      // Make the preview render in the studio's theme. Without this the frame
      // INHERITS `color-scheme` from the studio <html> (next-themes sets it), so in
      // dark mode a template that declares `color-scheme: light dark` gets white UA
      // text — but the frame's backdrop stayed light, so text vanished on white.
      // Setting it on the element ties both the embedded document's used scheme AND
      // the iframe's own default backdrop to the chosen theme, so it's always legible.
      style={{ colorScheme }}
      sandbox={previewSandbox(hasSeparatePreviewOrigin)}
    />
  );
}

export function PreviewPanel() {
  const { c, snap } = useIde();
  const { resolvedTheme } = useTheme();
  const colorScheme: "light" | "dark" = resolvedTheme === "light" ? "light" : "dark";
  const tabs = snap.previewTabs;
  const active = tabs.find((t) => t.id === snap.activePreviewId) ?? null;

  return (
    <div className="flex h-full flex-col bg-sidebar">
      {/* tab strip */}
      <div className="flex h-8 shrink-0 items-stretch border-b bg-chrome">
        <div className="flex flex-1 items-stretch overflow-x-auto">
          {tabs.map((t) => {
            const isActive = t.id === snap.activePreviewId;
            return (
              <ContextMenu key={t.id}>
                <ContextMenuTrigger className="contents">
                  <div
                    title={tabTitle(t)}
                    onClick={() => c.preview.activatePreviewTab(t.id)}
                    className={cn(
                      "group flex cursor-pointer items-center gap-1.5 border-r px-3 text-xs",
                      isActive
                        ? "bg-sidebar text-foreground"
                        : "bg-chrome text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Globe className="size-3.5 shrink-0 opacity-70" />
                    <span className="max-w-32 truncate">{tabTitle(t)}</span>
                    <button
                      title={translate("preview.close")}
                      className="flex size-4 items-center justify-center rounded hover:bg-accent"
                      onClick={(e) => {
                        e.stopPropagation();
                        c.preview.closePreviewTab(t.id);
                      }}
                    >
                      <X
                        className={cn("size-3", isActive ? "block" : "hidden group-hover:block")}
                      />
                    </button>
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent className="w-48">
                  <ContextMenuItem onClick={() => c.preview.closePreviewTab(t.id)}>
                    {translate("preview.close")}
                  </ContextMenuItem>
                  <ContextMenuItem
                    disabled={tabs.length <= 1}
                    onClick={() => c.preview.closeOtherPreviewTabs(t.id)}
                  >
                    {translate("preview.closeOthers")}
                  </ContextMenuItem>
                  <ContextMenuItem
                    disabled={tabs.findIndex((x) => x.id === t.id) >= tabs.length - 1}
                    onClick={() => c.preview.closePreviewTabsToRight(t.id)}
                  >
                    {translate("preview.closeRight")}
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem onClick={() => c.preview.closeAllPreviewTabs()}>
                    {translate("preview.closeAll")}
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            );
          })}
        </div>
        <Tooltip>
          <TooltipTrigger
            onClick={() => c.preview.addPreviewTab()}
            aria-label={translate("preview.newTab")}
            className="flex w-8 shrink-0 items-center justify-center border-l text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Plus className="size-4" />
          </TooltipTrigger>
          <TooltipContent>{translate("preview.newTab")}</TooltipContent>
        </Tooltip>
      </div>

      {/* address / nav toolbar (only with an active tab) */}
      {active && (
        <div className="flex h-9 shrink-0 items-center gap-0.5 border-b px-1.5">
          <ToolButton
            label={translate("preview.back")}
            onClick={() => c.preview.previewBack(active.id)}
          >
            <ArrowLeft className="size-4" />
          </ToolButton>
          <ToolButton
            label={translate("preview.forward")}
            onClick={() => c.preview.previewForward(active.id)}
          >
            <ArrowRight className="size-4" />
          </ToolButton>
          <ToolButton
            label={translate("preview.reload")}
            onClick={() => c.preview.reloadPreviewTab(active.id)}
          >
            <RotateCw className="size-4" />
          </ToolButton>
          {/* Address bar — local-only: localhost / 127.0.0.1 / a bare path loads the
              in-VM dev server; external URLs are rejected (see navigatePreview). */}
          <div className="mx-1 flex flex-1 items-center gap-1.5 rounded bg-background px-2 py-1">
            <Lock className="size-3 shrink-0 text-muted-foreground" />
            <input
              value={active.url}
              onChange={(e) => c.preview.setPreviewUrl(active.id, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter")
                  c.preview.navigatePreview(active.id, (e.target as HTMLInputElement).value);
              }}
              placeholder="localhost:3000"
              aria-label={translate("preview.address")}
              spellCheck={false}
              className="w-full bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
            />
          </div>
          <ToolButton
            label={
              snap.devtoolsOpen
                ? translate("preview.closeDevtools")
                : translate("preview.openDevtools")
            }
            onClick={() => c.preview.devtools.toggleDevtools()}
          >
            <SquareTerminal className={cn("size-4", snap.devtoolsOpen && "text-foreground")} />
          </ToolButton>
          <ToolButton
            label={translate("preview.openExternal")}
            disabled={active.port == null}
            onClick={() => c.preview.openPreviewExternal(active.id)}
          >
            <ExternalLink className="size-4" />
          </ToolButton>
        </div>
      )}

      {/* body — a vertical split: the preview iframes on top, the DevTools frontend
          below when open. All preview iframes stay mounted so each tab keeps its
          state + HMR socket; the DevTools iframe remounts (key) on re-attach. */}
      <ResizablePanelGroup orientation="vertical" className="min-h-0 flex-1">
        <ResizablePanel id="preview-body" className="relative overflow-hidden bg-editor">
          {tabs.map((t) => (
            <PreviewFrame
              key={t.id}
              tab={t}
              active={t.id === snap.activePreviewId}
              src={c.preview.previewSrc(t)}
              colorScheme={colorScheme}
              setFrame={(id, el) => c.preview.setPreviewFrame(id, el)}
              onLoad={(id) => c.preview.onPreviewFrameLoad(id)}
            />
          ))}
          {active && active.port == null && <PreviewEmptyTab />}
          {tabs.length === 0 && <PreviewEmptyState />}
        </ResizablePanel>
        {snap.devtoolsOpen && (
          <>
            <ResizableHandle />
            <ResizablePanel
              id="preview-devtools"
              defaultSize="45%"
              minSize="15%"
              className="bg-overlay"
            >
              <iframe
                key={snap.devtoolsNonce}
                ref={(el) => c.preview.devtools.setDevtoolsFrame(el)}
                onLoad={() => c.preview.devtools.onDevtoolsReady()}
                title={translate("preview.devtoolsTitle")}
                src={c.preview.devtools.devtoolsSrc()}
                className="h-full w-full border-0"
              />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    </div>
  );
}
