import { useState } from "react";
import {
  Avatar,
  AvatarStack,
  Badge,
  Button,
  Card,
  Dialog,
  Pagination,
  Select,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableToolbar,
  toast,
} from "@facilis/ui";
import { Section } from "./section.tsx";

const TEAM = ["Ada Lovelace", "Grace Hopper", "Alan Turing", "Edsger Dijkstra", "Barbara Liskov"];

const ROWS = [
  { id: "INV-001", customer: "Northwind Studio", status: "paid", total: "EUR 1,200.00" },
  { id: "INV-002", customer: "Atlas Labs", status: "pending", total: "EUR 450.00" },
  { id: "INV-003", customer: "Meridian Co.", status: "overdue", total: "EUR 2,100.00" },
  { id: "INV-004", customer: "Lumen Works", status: "paid", total: "EUR 780.00" },
  { id: "INV-005", customer: "Orbit Systems", status: "pending", total: "EUR 320.00" },
  { id: "INV-006", customer: "Harbor Group", status: "paid", total: "EUR 1,650.00" },
  { id: "INV-007", customer: "Field Notes", status: "overdue", total: "EUR 990.00" },
] as const;

const PAGE_SIZE = 3;

const STATUS_TONE = {
  paid: "success",
  pending: "warning",
  overdue: "error",
} as const;

export function FeedbackSection() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [securityAlerts, setSecurityAlerts] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);

  const query = search.trim().toLowerCase();
  const filtered = ROWS.filter((row) => {
    const matchesSearch =
      query === "" || row.customer.toLowerCase().includes(query) || row.id.toLowerCase() === query;
    const matchesStatus = status === "all" || row.status === status;
    return matchesSearch && matchesStatus;
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <Section
      id="feedback"
      title="Interaction"
      description="The remaining patterns: a controlled dialog, token switches, avatars, a filterable table toolbar and pagination."
    >
      <div className="gallery-grid">
        <div className="gallery-panel">
          <h3 className="gallery-panel__title">Dialog</h3>
          <div className="gallery-stack">
            <Button onClick={() => setDialogOpen(true)}>Open dialog</Button>
            <span className="gallery-muted">
              Esc and the backdrop close it; focus moves in, stays inside and is restored.
            </span>
          </div>
        </div>

        <div className="gallery-panel">
          <h3 className="gallery-panel__title">Switch</h3>
          <div className="gallery-stack">
            <label className="gallery-inline-label">
              <Switch
                label="Email notifications"
                checked={emailNotifications}
                onChange={setEmailNotifications}
              />
              Email notifications
            </label>
            <label className="gallery-inline-label">
              <Switch
                label="Security alerts"
                checked={securityAlerts}
                onChange={setSecurityAlerts}
              />
              Security alerts
            </label>
            <label className="gallery-inline-label">
              <Switch label="Locked setting" checked disabled onChange={() => undefined} />
              Disabled switch
            </label>
          </div>
        </div>

        <div className="gallery-panel">
          <h3 className="gallery-panel__title">Avatars</h3>
          <div className="gallery-row">
            <Avatar name="Ada Lovelace" size="sm" />
            <Avatar name="Grace Hopper" />
            <Avatar name="Alan Turing" size="lg" />
          </div>
          <AvatarStack names={TEAM} max={4} />
          <span className="gallery-muted">
            Initials and tint are deterministic from the name; no colour prop exists.
          </span>
        </div>
      </div>

      <Card flush>
        <TableToolbar
          search={search}
          onSearchChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          searchLabel="Search invoices"
          searchPlaceholder="Search invoices…"
          filters={
            <Select
              aria-label="Filter by status"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
            >
              <option value="all">All statuses</option>
              <option value="paid">Paid</option>
              <option value="pending">Pending</option>
              <option value="overdue">Overdue</option>
            </Select>
          }
          actions={<Button size="sm">Export</Button>}
        />

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Invoice</TableHead>
              <TableHead scope="col">Customer</TableHead>
              <TableHead scope="col">Status</TableHead>
              <TableHead scope="col">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{row.id}</TableCell>
                <TableCell>{row.customer}</TableCell>
                <TableCell>
                  <Badge tone={STATUS_TONE[row.status]}>{row.status}</Badge>
                </TableCell>
                <TableCell>{row.total}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <Pagination
          page={currentPage}
          pageCount={pageCount}
          total={filtered.length}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
        />
      </Card>

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title="Delete project?"
        description="Northwind website and its history will be removed for every member."
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setDialogOpen(false);
                toast.success("Project deleted");
              }}
            >
              Delete project
            </Button>
          </>
        }
      >
        <p className="gallery-muted">
          Members keep their other projects, and billing usage is recalculated at the end of the
          month.
        </p>
      </Dialog>
    </Section>
  );
}
