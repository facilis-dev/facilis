import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Field,
  Input,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from "@facilis/ui";
import { Section } from "./section.tsx";

const BADGE_TONES = ["neutral", "primary", "success", "warning", "error", "info"] as const;
const ALERT_TONES = ["info", "success", "warning", "error"] as const;

const INVOICES = [
  { id: "INV-001", customer: "Northwind Studio", status: "Paid", tone: "success" as const },
  { id: "INV-002", customer: "Atlas Labs", status: "Pending", tone: "warning" as const },
  { id: "INV-003", customer: "Meridian Co.", status: "Overdue", tone: "error" as const },
];

export function ComponentsSection() {
  return (
    <Section
      id="components"
      title="Primitives"
      description="The base kit: every control reads the same tokens, so it looks native in both themes and in a project that only imports theme.css."
    >
      <div className="gallery-panel">
        <h3 className="gallery-panel__title">Buttons</h3>
        <div className="gallery-row">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button size="sm">Small</Button>
          <Button disabled>Disabled</Button>
        </div>
      </div>

      <div className="gallery-panel">
        <h3 className="gallery-panel__title">Form controls</h3>
        <div className="gallery-grid">
          <Field label="Project name" hint="Lowercase letters, numbers and dashes.">
            <Input name="project" placeholder="my-app" />
          </Field>
          <Field label="Email" error="Enter a valid email address.">
            <Input name="email" type="email" defaultValue="not-an-email" />
          </Field>
          <Field label="Locale">
            <Select name="locale" defaultValue="en">
              <option value="en">English</option>
              <option value="it">Italiano</option>
            </Select>
          </Field>
          <Field label="Description" hint="Plain text only.">
            <Textarea name="description" rows={3} placeholder="What does this project do?" />
          </Field>
        </div>
        <div className="gallery-row">
          <label className="gallery-inline-label">
            <Checkbox name="newsletter" defaultChecked />
            Subscribe to release notes
          </label>
          <label className="gallery-inline-label">
            <Checkbox name="beta" disabled />
            Beta features (disabled)
          </label>
        </div>
      </div>

      <div className="gallery-panel">
        <h3 className="gallery-panel__title">Table</h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Invoice</TableHead>
              <TableHead scope="col">Customer</TableHead>
              <TableHead scope="col">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {INVOICES.map((invoice) => (
              <TableRow key={invoice.id}>
                <TableCell>{invoice.id}</TableCell>
                <TableCell>{invoice.customer}</TableCell>
                <TableCell>
                  <Badge tone={invoice.tone}>{invoice.status}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="gallery-grid">
        <div className="gallery-panel">
          <h3 className="gallery-panel__title">Badges</h3>
          <div className="gallery-row">
            {BADGE_TONES.map((tone) => (
              <Badge key={tone} tone={tone}>
                {tone}
              </Badge>
            ))}
          </div>
        </div>

        <div className="gallery-panel">
          <h3 className="gallery-panel__title">Alerts</h3>
          <div className="gallery-stack">
            {ALERT_TONES.map((tone) => (
              <Alert key={tone} tone={tone}>
                <strong>{tone}</strong> keeps its role and a tinted surface.
              </Alert>
            ))}
          </div>
        </div>
      </div>
    </Section>
  );
}
