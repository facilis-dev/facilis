/**
 * Mock data for the design lab. Realistic names, owners and dates matter: the lab exists to
 * judge density, hierarchy and rhythm, and placeholder copy hides exactly those problems.
 * Values are static (no Date.now) so every render/screenshot is comparable.
 */

export type Status = "active" | "paused" | "archived";

export type User = {
  readonly id: string;
  readonly name: string;
  readonly email: string;
};

export type Project = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly status: Status;
  readonly owner: User;
  readonly members: readonly User[];
  readonly updatedAt: string;
  readonly startDate: string;
};

export type Stat = {
  readonly label: string;
  readonly value: string;
  readonly meta: string;
  readonly trend?: { readonly direction: "up" | "down"; readonly value: string };
  readonly progress?: number;
};

export type TeamRole = "Owner" | "Admin" | "Member";

export type TeamMember = {
  readonly user: User;
  readonly role: TeamRole;
  readonly status: "Active" | "Invited";
  readonly lastActive: string;
};

export type NotificationSetting = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly checked: boolean;
};

export type UsageMetric = {
  readonly label: string;
  readonly detail: string;
  readonly percent: number;
};

export const currentUser: User = {
  id: "u1",
  name: "Giulia Ferri",
  email: "giulia@northwind.studio",
};

const marco: User = { id: "u2", name: "Marco Rinaldi", email: "marco@northwind.studio" };
const anika: User = { id: "u3", name: "Anika Rao", email: "anika@northwind.studio" };
const tomas: User = { id: "u4", name: "Tomás Silva", email: "tomas@northwind.studio" };
const elena: User = { id: "u5", name: "Elena Petrova", email: "elena@northwind.studio" };
const noah: User = { id: "u6", name: "Noah Weber", email: "noah@northwind.studio" };
const sofia: User = { id: "u7", name: "Sofia Lindqvist", email: "sofia@northwind.studio" };
const daniel: User = { id: "u8", name: "Daniel Okafor", email: "daniel@northwind.studio" };

export const users: readonly User[] = [
  currentUser,
  marco,
  anika,
  tomas,
  elena,
  noah,
  sofia,
  daniel,
];

export const projects: readonly Project[] = [
  {
    id: "p1",
    name: "Atlas CRM",
    description: "Customer workspace for the mid-market sales team.",
    status: "active",
    owner: currentUser,
    members: [currentUser, marco, anika, sofia, daniel],
    updatedAt: "2026-10-30",
    startDate: "2026-01-15",
  },
  {
    id: "p2",
    name: "Orbit Analytics",
    description: "Product usage dashboards and weekly retention reports.",
    status: "active",
    owner: marco,
    members: [marco, anika, elena, noah],
    updatedAt: "2026-10-29",
    startDate: "2026-02-03",
  },
  {
    id: "p3",
    name: "Beacon Onboarding",
    description: "Guided activation flow for new workspace admins.",
    status: "active",
    owner: anika,
    members: [anika, sofia, daniel],
    updatedAt: "2026-10-27",
    startDate: "2026-03-21",
  },
  {
    id: "p4",
    name: "Ledger Sync",
    description: "Two-way invoice sync with the finance stack.",
    status: "paused",
    owner: tomas,
    members: [tomas, elena, noah, marco, currentUser, sofia],
    updatedAt: "2026-10-24",
    startDate: "2026-04-09",
  },
  {
    id: "p5",
    name: "Cinder Marketing",
    description: "Campaign landing pages and lifecycle email.",
    status: "active",
    owner: elena,
    members: [elena, daniel],
    updatedAt: "2026-10-21",
    startDate: "2026-05-18",
  },
  {
    id: "p6",
    name: "Harbor Support",
    description: "Shared inbox and SLA reporting for customer support.",
    status: "active",
    owner: noah,
    members: [noah, sofia, daniel, anika, marco, currentUser, tomas, elena],
    updatedAt: "2026-10-18",
    startDate: "2026-06-02",
  },
  {
    id: "p7",
    name: "Meridian Billing",
    description: "Subscription plans, proration and tax rules.",
    status: "paused",
    owner: currentUser,
    members: [currentUser, tomas, elena, noah, marco],
    updatedAt: "2026-10-14",
    startDate: "2026-07-27",
  },
  {
    id: "p8",
    name: "Nozomi Docs",
    description: "Public documentation and release notes.",
    status: "archived",
    owner: anika,
    members: [anika],
    updatedAt: "2026-10-09",
    startDate: "2026-08-11",
  },
];

export const stats: readonly Stat[] = [
  {
    label: "Active projects",
    value: "24",
    meta: "vs last month",
    trend: { direction: "up", value: "12%" },
  },
  {
    label: "Team members",
    value: "42",
    meta: "2 invites pending",
    trend: { direction: "up", value: "4" },
  },
  {
    label: "Storage used",
    value: "32.4 GB",
    meta: "of 50 GB included",
    progress: 65,
  },
];

export const team: readonly TeamMember[] = [
  { user: currentUser, role: "Owner", status: "Active", lastActive: "Online now" },
  { user: marco, role: "Admin", status: "Active", lastActive: "12 min ago" },
  { user: anika, role: "Member", status: "Active", lastActive: "1 hour ago" },
  { user: tomas, role: "Member", status: "Active", lastActive: "Yesterday" },
  { user: sofia, role: "Member", status: "Invited", lastActive: "Invite sent 2 days ago" },
];

/** The side card on the detail screen — a smaller, curated slice of the team. */
export const projectTeam: readonly { readonly user: User; readonly role: string }[] = [
  { user: currentUser, role: "Owner" },
  { user: marco, role: "Editor" },
  { user: anika, role: "Editor" },
  { user: sofia, role: "Viewer" },
];

export const notificationSettings: readonly NotificationSetting[] = [
  {
    id: "mentions",
    title: "Mentions and comments",
    description: "Get an email when someone mentions you or replies to a thread you follow.",
    checked: true,
  },
  {
    id: "digest",
    title: "Weekly project digest",
    description: "A Monday summary of status changes, due dates and blocked work.",
    checked: true,
  },
  {
    id: "deploys",
    title: "Deploy and release updates",
    description: "Release notes and deployment failures for projects you own.",
    checked: false,
  },
  {
    id: "product",
    title: "Product announcements",
    description: "Occasional notes about new Facilis features. Never more than once a month.",
    checked: false,
  },
  {
    id: "security",
    title: "Security alerts",
    description: "Sign-ins from new devices and permission changes. Always recommended.",
    checked: true,
  },
];

export const plan = {
  name: "Scale",
  price: "$49",
  cadence: "per seat / month",
  seats: "12 of 20 seats",
  renewal: "Renews Nov 30, 2026",
  metrics: [
    { label: "Projects", detail: "24 of 50", percent: 48 },
    { label: "Storage", detail: "32.4 GB of 50 GB", percent: 65 },
    { label: "API requests", detail: "640k of 1M", percent: 64 },
  ] satisfies readonly UsageMetric[],
};

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** Fixed en-GB formatter: dates read the same in every screenshot. */
export function formatDate(value: string): string {
  return dateFormatter.format(new Date(value));
}
