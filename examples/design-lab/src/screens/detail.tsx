import { useState, type FormEvent } from "react";
import { Badge, Button, Checkbox, Field, Input, Select, Textarea, toast } from "@facilis/ui";
import { AppShell } from "../components/app-shell.tsx";
import { Avatar } from "../components/bits.tsx";
import { Card } from "../components/card.tsx";
import { Dialog } from "../components/dialog.tsx";
import { formatDate, projectTeam } from "../data.ts";
import { IconChevron, IconPlus, IconTrash } from "../icons.tsx";

function submitProject(event: FormEvent<HTMLFormElement>): void {
  event.preventDefault();
  toast.success("Project settings saved");
}

/** Detail / form: page header, editable card, side cards and a delete confirmation. */
export function DetailScreen() {
  const [deleteOpen, setDeleteOpen] = useState(false);

  function confirmDelete(): void {
    setDeleteOpen(false);
    toast.success("Atlas CRM deleted");
  }

  return (
    <AppShell activeNav="Projects" breadcrumb={["Projects", "Atlas CRM"]}>
      <div className="lab-detail">
        <header className="lab-page-head">
          <div>
            <button
              type="button"
              className="lab-back"
              onClick={() => toast.info("Back to the projects table")}
            >
              <IconChevron className="lab-icon--left" size={14} />
              Projects
            </button>
            <div className="lab-page-head__title">
              <h1>Atlas CRM</h1>
              <Badge tone="success" className="lab-badge">
                <span className="lab-status-dot" />
                Active
              </Badge>
            </div>
            <p className="lab-page-head__desc">
              Customer workspace for the mid-market sales team. Last updated{" "}
              {formatDate("2026-10-30")} by Giulia Ferri.
            </p>
          </div>
          <div className="lab-page-head__actions">
            <Button variant="ghost" onClick={() => toast.info("Changes discarded")}>
              Cancel
            </Button>
            <Button type="submit" form="project-form">
              Save changes
            </Button>
          </div>
        </header>

        <div className="lab-columns">
          <div className="lab-columns__main">
            <Card title="Project details" description="Shown to everyone in the workspace.">
              <form className="lab-form" id="project-form" onSubmit={submitProject}>
                <div className="lab-form__grid">
                  <Field label="Project name">
                    <Input name="name" defaultValue="Atlas CRM" />
                  </Field>
                  <Field label="Slug" hint="Used in URLs and API paths.">
                    <Input name="slug" defaultValue="atlas-crm" />
                  </Field>
                  <Field
                    label="Description"
                    className="lab-form__full"
                    hint="A sentence or two for the project switcher."
                  >
                    <Textarea
                      name="description"
                      rows={4}
                      defaultValue="Customer workspace for the mid-market sales team: accounts, pipeline and the handoff to support."
                    />
                  </Field>
                  <Field label="Start date">
                    <Input type="date" name="startDate" defaultValue="2026-01-15" />
                  </Field>
                  <Field label="Owner">
                    <Select name="owner" defaultValue="giulia">
                      <option value="giulia">Giulia Ferri</option>
                      <option value="marco">Marco Rinaldi</option>
                      <option value="anika">Anika Rao</option>
                    </Select>
                  </Field>
                  <Field label="Visibility">
                    <Select name="visibility" defaultValue="private">
                      <option value="private">Private to members</option>
                      <option value="workspace">Everyone in the workspace</option>
                    </Select>
                  </Field>
                  <Field label="Review cadence">
                    <Select name="cadence" defaultValue="weekly">
                      <option value="weekly">Weekly</option>
                      <option value="biweekly">Every two weeks</option>
                      <option value="monthly">Monthly</option>
                    </Select>
                  </Field>
                </div>
                <label className="lab-check">
                  <Checkbox name="notify" defaultChecked />
                  Notify the team when this project changes
                </label>
                <div className="lab-form__actions">
                  <Button
                    variant="ghost"
                    type="button"
                    onClick={() => toast.info("Changes discarded")}
                  >
                    Cancel
                  </Button>
                  <Button type="submit">Save changes</Button>
                </div>
              </form>
            </Card>
          </div>

          <aside className="lab-columns__side">
            <Card title="Status">
              <div className="lab-rows">
                <div className="lab-row">
                  <span className="lab-row__label">Status</span>
                  <Badge tone="success" className="lab-badge">
                    <span className="lab-status-dot" />
                    Active
                  </Badge>
                </div>
                <div className="lab-row">
                  <span className="lab-row__label">Visibility</span>
                  <span className="lab-row__value">Private</span>
                </div>
                <div className="lab-row">
                  <span className="lab-row__label">Created</span>
                  <span className="lab-row__value lab-tabular">{formatDate("2026-01-15")}</span>
                </div>
                <div className="lab-row">
                  <span className="lab-row__label">Last deploy</span>
                  <span className="lab-row__value">2 hours ago</span>
                </div>
              </div>
            </Card>

            <Card
              title="Team"
              actions={
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toast.info("Manage access on Settings → Team")}
                >
                  Manage
                </Button>
              }
            >
              <div className="lab-team">
                {projectTeam.map((member) => (
                  <div className="lab-team__item" key={member.user.id}>
                    <Avatar name={member.user.name} size="sm" />
                    <span className="lab-team__name">{member.user.name}</span>
                    <span className="lab-team__meta">{member.role}</span>
                  </div>
                ))}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="lab-btn--block"
                onClick={() => toast.info("Invite people from Settings → Team")}
              >
                <IconPlus size={14} />
                Add members
              </Button>
            </Card>

            <Card
              title="Danger zone"
              description="Deleting a project removes its data, members and history."
              className="lab-card--danger"
            >
              <Button variant="danger" onClick={() => setDeleteOpen(true)}>
                <IconTrash size={14} />
                Delete project
              </Button>
            </Card>
          </aside>
        </div>
      </div>

      <Dialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete Atlas CRM?"
        description="The project, its history and every member's access will be removed. This cannot be undone."
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmDelete}>
              Delete project
            </Button>
          </>
        }
      >
        <p className="lab-hint">
          Export the project data first if you need it later: deletions are permanent.
        </p>
      </Dialog>
    </AppShell>
  );
}
