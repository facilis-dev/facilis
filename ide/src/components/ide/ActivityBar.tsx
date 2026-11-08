import { useSyncExternalStore } from "react";
import Files from "~icons/lucide/files";
import Search from "~icons/lucide/search";
import Bug from "~icons/lucide/bug";
import GitBranch from "~icons/lucide/git-branch";
import Sun from "~icons/lucide/sun";
import Moon from "~icons/lucide/moon";
import Monitor from "~icons/lucide/monitor";
import MessageSquare from "~icons/lucide/message-square";
import Database from "~icons/lucide/database";
import Network from "~icons/lucide/network";
import GitCompare from "~icons/lucide/git-compare";
import ScrollText from "~icons/lucide/scroll-text";
import Check from "~icons/lucide/check";
import { useTheme } from "next-themes";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { t, type MessageKey } from "@/i18n";
import { chatFor } from "@/ai/chat-host";
import { useIde } from "./useIde";

function ActBtn({
  label,
  active,
  busy,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  busy?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        onClick={onClick}
        // A tooltip is not an accessible name: without this the activity bar is four
        // buttons that announce as "button".
        aria-label={label}
        aria-busy={busy}
        className={cn(
          "flex h-12 w-12 items-center justify-center border-l-2 border-transparent text-muted-foreground transition-colors hover:text-foreground",
          active && "border-l-primary text-foreground",
        )}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

type View = "explorer" | "search" | "debug" | "scm" | "chat" | "data" | "release" | "logs";

export function ActivityBar() {
  const { c, snap } = useIde();
  // The Source Control changed-file count badge, driven by the SCM session store.
  const scm = useSyncExternalStore(c.scm.subscribe, c.scm.getSnapshot);
  const scmCount = scm.repos.reduce((n, r) => n + r.staged.length + r.changes.length, 0);
  // A turn can run while the user is looking at another view: keep a quiet activity mark
  // on the chat icon so it never looks frozen (D-101 PTC runs can take a few seconds).
  const chat = chatFor(c);
  const chatBusy = useSyncExternalStore(chat.subscribe, chat.getSnapshot).phase !== "idle";
  // Clicking the active view toggles the sidebar (VS Code behaviour); otherwise
  // switch to it.
  const select = (view: View) => {
    if (snap.activeView === view && !snap.sidebarCollapsed) c.toggleSidebar();
    else c.setActiveView(view);
  };
  const shown = (view: View) => snap.activeView === view && !snap.sidebarCollapsed;
  return (
    <div className="flex w-12 shrink-0 flex-col items-center border-r bg-sidebar py-1">
      <ActBtn
        label={t("activity.workspace")}
        active={shown("explorer")}
        onClick={() => select("explorer")}
      >
        <Files className="size-5" />
      </ActBtn>
      <ActBtn
        label={t("activity.search")}
        active={shown("search")}
        onClick={() => select("search")}
      >
        <Search className="size-5" />
      </ActBtn>
      <ActBtn label={t("activity.scm")} active={shown("scm")} onClick={() => select("scm")}>
        <span className="relative">
          <GitBranch className="size-5" />
          {scmCount > 0 && (
            <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium leading-none text-primary-foreground">
              {scmCount > 99 ? "99+" : scmCount}
            </span>
          )}
        </span>
      </ActBtn>
      <ActBtn label={t("activity.data")} active={shown("data")} onClick={() => select("data")}>
        <Database className="size-5" />
      </ActBtn>
      <ActBtn
        label={t("activity.projectGraph")}
        // The project graph also lives in the editor area, so it is active when its tab is.
        active={snap.activeTab !== null && snap.tabKinds[snap.activeTab] === "project-graph"}
        onClick={() => c.openProjectGraph()}
      >
        <Network className="size-5" />
      </ActBtn>
      <ActBtn
        label={t("activity.release")}
        active={shown("release")}
        onClick={() => select("release")}
      >
        <GitCompare className="size-5" />
      </ActBtn>
      <ActBtn label={t("activity.logs")} active={shown("logs")} onClick={() => select("logs")}>
        <ScrollText className="size-5" />
      </ActBtn>
      <ActBtn label={t("activity.debug")} active={shown("debug")} onClick={() => select("debug")}>
        <Bug className="size-5" />
      </ActBtn>
      <ActBtn
        label={t("activity.chat")}
        active={shown("chat")}
        busy={chatBusy}
        onClick={() => select("chat")}
      >
        <span className="relative">
          <MessageSquare className="size-5" />
          {chatBusy && (
            <span
              aria-hidden="true"
              className="absolute -right-1.5 -top-1 size-2.5 animate-pulse rounded-full bg-brand ring-2 ring-sidebar"
            />
          )}
        </span>
      </ActBtn>
      <ThemeToggle />
    </div>
  );
}

const THEME_OPTIONS: { value: string; labelKey: MessageKey; Icon: typeof Sun }[] = [
  { value: "system", labelKey: "theme.option.system", Icon: Monitor },
  { value: "light", labelKey: "theme.option.light", Icon: Sun },
  { value: "dark", labelKey: "theme.option.dark", Icon: Moon },
];

function ThemeToggle() {
  const { theme = "system", setTheme, resolvedTheme } = useTheme();
  const CurrentIcon = resolvedTheme === "light" ? Sun : Moon;
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              className="mt-auto flex h-12 w-12 items-center justify-center border-l-2 border-transparent text-muted-foreground transition-colors hover:text-foreground data-[popup-open]:text-foreground"
              aria-label={t("activity.theme")}
            />
          }
        >
          <CurrentIcon className="size-5" />
        </TooltipTrigger>
        <TooltipContent side="right">{t("activity.theme")}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent side="right" align="end" className="min-w-40">
        {THEME_OPTIONS.map(({ value, labelKey, Icon }) => (
          <DropdownMenuItem key={value} onClick={() => setTheme(value)}>
            <Icon className="size-4" />
            <span className="flex-1">{t(labelKey)}</span>
            {theme === value && <Check className="size-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
