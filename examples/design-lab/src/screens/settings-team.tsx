import { useState, type FormEvent } from "react";
import {
  Badge,
  Button,
  Field,
  Input,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@facilis/ui";
import { Avatar } from "../components/bits.tsx";
import { Card } from "../components/card.tsx";
import { Dialog } from "../components/dialog.tsx";
import { team, type TeamRole } from "../data.ts";
import { IconPlus } from "../icons.tsx";

const ROLE_TONE: Record<TeamRole, "primary" | "info" | "neutral"> = {
  Owner: "primary",
  Admin: "info",
  Member: "neutral",
};

export function TeamPanel() {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("Member");

  function sendInvite(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setInviteOpen(false);
    setEmail("");
    toast.success("Invitation sent to " + (email.trim() === "" ? "the teammate" : email.trim()));
  }

  return (
    <>
      <Card
        title="Team"
        description="People with access to this workspace."
        actions={
          <Button size="sm" onClick={() => setInviteOpen(true)}>
            <IconPlus size={14} />
            Invite member
          </Button>
        }
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Member</TableHead>
              <TableHead scope="col">Role</TableHead>
              <TableHead scope="col">Status</TableHead>
              <TableHead scope="col" className="lab-col-updated">
                Last active
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {team.map((member) => (
              <TableRow key={member.user.id}>
                <TableCell>
                  <span className="lab-cell-owner">
                    <Avatar name={member.user.name} size="sm" />
                    <span className="lab-cell-project">
                      <span className="lab-cell-project__name">{member.user.name}</span>
                      <span className="lab-cell-project__desc">{member.user.email}</span>
                    </span>
                  </span>
                </TableCell>
                <TableCell>
                  <Badge tone={ROLE_TONE[member.role]} className="lab-badge">
                    {member.role}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge
                    tone={member.status === "Active" ? "success" : "warning"}
                    className="lab-badge"
                  >
                    <span className="lab-status-dot" />
                    {member.status}
                  </Badge>
                </TableCell>
                <TableCell className="lab-col-updated">
                  <span className="lab-muted">{member.lastActive}</span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Invite a teammate"
        description="They get an email invitation to join the Northwind workspace."
        footer={
          <>
            <Button variant="ghost" onClick={() => setInviteOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="invite-form" disabled={email.trim() === ""}>
              Send invitation
            </Button>
          </>
        }
      >
        <form className="lab-form" id="invite-form" onSubmit={sendInvite}>
          <Field label="Work email" hint="Use the address they will sign in with.">
            <Input
              type="email"
              value={email}
              placeholder="name@company.com"
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          <Field label="Role">
            <Select value={role} onChange={(event) => setRole(event.target.value)}>
              <option>Member</option>
              <option>Admin</option>
            </Select>
          </Field>
        </form>
      </Dialog>
    </>
  );
}
