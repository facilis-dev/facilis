import { Page } from "@facilis/ui";
import { AppShell } from "../components/app-shell.tsx";
import { Tabs, type TabItem } from "../components/tabs.tsx";
import { BillingPanel } from "./settings-billing.tsx";
import { NotificationsPanel, ProfilePanel } from "./settings-panels.tsx";
import { TeamPanel } from "./settings-team.tsx";

const TABS: readonly TabItem[] = [
  { id: "profile", label: "Profile", content: <ProfilePanel /> },
  { id: "notifications", label: "Notifications", content: <NotificationsPanel /> },
  { id: "team", label: "Team", content: <TeamPanel /> },
  { id: "billing", label: "Billing", content: <BillingPanel /> },
];

/** Settings: one tab bar, four real panels (profile form, switches, team table, billing). */
export function SettingsScreen() {
  return (
    <AppShell activeNav="Settings" breadcrumb={["Workspace", "Settings"]}>
      <Page
        title="Settings"
        description="Manage your profile, notifications, team access and billing."
      >
        <Tabs label="Settings sections" tabs={TABS} />
      </Page>
    </AppShell>
  );
}
