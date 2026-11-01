import { Button, Card, Menu, Skeleton, StatCard, Tabs, toast } from "@facilis/ui";
import { Section } from "./section.tsx";

const SETTINGS_TABS = [
  {
    id: "profile",
    label: "Profile",
    content: <p className="gallery-muted">Profile settings panel.</p>,
  },
  {
    id: "notifications",
    label: "Notifications",
    content: <p className="gallery-muted">Notification preferences panel.</p>,
  },
  { id: "billing", label: "Billing", content: <p className="gallery-muted">Billing panel.</p> },
] as const;

export function PatternsSection() {
  return (
    <Section
      id="patterns"
      title="Patterns"
      description="Composed surfaces built from the same tokens: cards, metrics, tabs, an overflow menu and placeholders."
    >
      <div className="gallery-grid">
        <Card
          title="Workspace"
          description="Settings that apply to everyone in the workspace."
          actions={
            <Button variant="ghost" size="sm">
              Edit
            </Button>
          }
          footer={
            <>
              <Button variant="ghost" size="sm">
                Cancel
              </Button>
              <Button size="sm" onClick={() => toast.success("Workspace saved")}>
                Save
              </Button>
            </>
          }
        >
          <p className="gallery-muted">
            The card is the default surface for grouped content: one hairline border and one subtle
            shadow, never both a border and a heavy drop shadow.
          </p>
        </Card>

        <Card flush>
          <div className="gallery-flush-body">
            <p className="gallery-muted">
              <strong>flush</strong> removes the body padding for edge-to-edge content such as
              tables and toolbars.
            </p>
          </div>
        </Card>
      </div>

      <div className="gallery-grid gallery-grid--stats">
        <StatCard
          label="Active projects"
          value="24"
          meta="vs. last month"
          trend={{ direction: "up", value: "12%" }}
          icon={<span aria-hidden="true">▦</span>}
        />
        <StatCard
          label="Open invoices"
          value="7"
          meta="2 overdue"
          trend={{ direction: "down", value: "3" }}
          icon={<span aria-hidden="true">◈</span>}
        />
        <StatCard
          label="Storage used"
          value="7.2 GB"
          progress={72}
          meta="of 10 GB"
          icon={<span aria-hidden="true">◍</span>}
        />
      </div>

      <div className="gallery-panel">
        <h3 className="gallery-panel__title">Tabs</h3>
        <Tabs label="Settings sections" tabs={SETTINGS_TABS} />
      </div>

      <div className="gallery-grid">
        <div className="gallery-panel">
          <h3 className="gallery-panel__title">Menu</h3>
          <div className="gallery-row">
            <Menu
              label="Row actions"
              items={[
                { label: "Duplicate", onSelect: () => toast.info("Duplicated") },
                { label: "Archive", onSelect: () => toast.success("Archived") },
                {
                  label: "Delete",
                  tone: "danger",
                  onSelect: () => toast.error("Deleted"),
                },
              ]}
            />
            <span className="gallery-muted">Overflow menu with a danger item.</span>
          </div>
        </div>

        <div className="gallery-panel">
          <h3 className="gallery-panel__title">Skeleton</h3>
          <div className="gallery-stack">
            <Skeleton height="1.25rem" width="60%" />
            <Skeleton height="0.75rem" width="90%" />
            <Skeleton height="0.75rem" width="75%" />
          </div>
        </div>
      </div>
    </Section>
  );
}
