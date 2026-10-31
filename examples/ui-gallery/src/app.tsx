import { useEffect, useState, type ReactNode } from "react";
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
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  Toaster,
  toast,
} from "@facilis/ui";

type Theme = "light" | "dark";

const badgeTones = ["neutral", "primary", "success", "warning", "error", "info"] as const;
const alertTones = ["info", "success", "warning", "error"] as const;
const toastTones = ["info", "success", "warning", "error"] as const;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="gallery-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function App() {
  const [theme, setTheme] = useState<Theme>("light");

  // The kit reads the theme from the root element, so the gallery only flips the data attribute.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <div className="gallery">
      <header className="gallery-header">
        <div>
          <h1>Facilis UI gallery</h1>
          <p>
            Every base-kit component on one page, styled only by the role variables in{" "}
            <code>theme.css</code>.
          </p>
        </div>
        <Button
          variant="secondary"
          onClick={() => setTheme((current) => (current === "light" ? "dark" : "light"))}
        >
          {theme === "light" ? "Switch to dark" : "Switch to light"}
        </Button>
      </header>

      <Section title="Buttons">
        <div className="gallery-row">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button size="sm">Small</Button>
          <Button disabled>Disabled</Button>
        </div>
      </Section>

      <Section title="Fields and inputs">
        <div className="gallery-grid">
          <Field label="Project name" hint="Lowercase letters, numbers and dashes.">
            <Input name="project" placeholder="my-app" />
          </Field>
          <Field label="Email" error="Enter a valid email address.">
            <Input
              name="email"
              type="email"
              placeholder="you@example.com"
              defaultValue="not-an-email"
            />
          </Field>
          <Field label="Description" hint="Plain text only.">
            <Textarea name="description" placeholder="What does this project do?" />
          </Field>
          <Field label="Locale">
            <Select name="locale" defaultValue="en">
              <option value="en">English</option>
              <option value="it">Italiano</option>
            </Select>
          </Field>
          <Field label="Subscribe to release notes" hint="One email per release, no more.">
            <Checkbox name="subscribe" />
          </Field>
        </div>
      </Section>

      <Section title="Table">
        <Table>
          <TableCaption>Open invoices</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>INV-001</TableCell>
              <TableCell>
                <Badge tone="success">Paid</Badge>
              </TableCell>
              <TableCell>EUR 1,200.00</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>INV-002</TableCell>
              <TableCell>
                <Badge tone="warning">Pending</Badge>
              </TableCell>
              <TableCell>EUR 450.00</TableCell>
            </TableRow>
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell>Total</TableCell>
              <TableCell />
              <TableCell>EUR 1,650.00</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </Section>

      <Section title="Badges">
        <div className="gallery-row">
          {badgeTones.map((tone) => (
            <Badge key={tone} tone={tone}>
              {tone}
            </Badge>
          ))}
        </div>
      </Section>

      <Section title="Alerts">
        <div className="gallery-stack">
          {alertTones.map((tone) => (
            <Alert key={tone} tone={tone}>
              <strong>{tone}</strong>: the tone selects the role and the role class.
            </Alert>
          ))}
        </div>
      </Section>

      <Section title="Toasts">
        <div className="gallery-row">
          {toastTones.map((tone) => (
            <Button
              key={tone}
              variant="ghost"
              onClick={() => toast[tone]("A " + tone + " toast dismisses itself after 4 seconds.")}
            >
              Show {tone}
            </Button>
          ))}
        </div>
      </Section>

      <Toaster />
    </div>
  );
}
