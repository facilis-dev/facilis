import {
  Alert,
  AuthShell,
  Button,
  EmptyState,
  Field,
  Input,
  Page,
  Skeleton,
  Spinner,
  toast,
} from "@facilis/ui";
import { Section } from "./section.tsx";

const TOAST_TONES = ["info", "success", "warning", "error"] as const;

export function TemplatesSection() {
  return (
    <Section
      id="templates"
      title="Page templates and states"
      description="Page, AuthShell, EmptyState and Spinner are the neutral shells every generated route composes; loading, error and empty are the three explicit data states."
    >
      <div className="gallery-panel">
        <h3 className="gallery-panel__title">Page</h3>
        <Page
          title="Projects"
          description="Every project the team is building, with owners and status."
          actions={
            <>
              <Button variant="ghost" size="sm">
                Export
              </Button>
              <Button size="sm">New project</Button>
            </>
          }
        >
          <EmptyState
            title="No projects yet"
            description="Create the first project and invite the team when it is ready."
            action={<Button>Create project</Button>}
          />
        </Page>
      </div>

      <div className="gallery-grid">
        <div className="gallery-panel">
          <h3 className="gallery-panel__title">AuthShell</h3>
          <AuthShell
            title="Sign in"
            subtitle="Continue to the Northwind workspace."
            footer={<span>New here? Ask an admin for an invite.</span>}
          >
            <Field label="Work email">
              <Input type="email" name="gallery-email" placeholder="you@example.com" />
            </Field>
            <Field label="Password">
              <Input type="password" name="gallery-password" />
            </Field>
            <Button onClick={() => toast.success("Welcome back.")}>Sign in</Button>
          </AuthShell>
        </div>

        <div className="gallery-panel">
          <h3 className="gallery-panel__title">Spinner</h3>
          <div className="gallery-row">
            <Spinner label="Loading projects" />
            <span className="gallery-muted">Labelled: role=status</span>
          </div>
          <div className="gallery-row">
            <Spinner />
            <span className="gallery-muted">Decorative: aria-hidden</span>
          </div>
          <h3 className="gallery-panel__title">Skeleton</h3>
          <div className="gallery-stack">
            <Skeleton height="1rem" width="70%" />
            <Skeleton height="1rem" width="45%" />
            <div className="gallery-row">
              <Skeleton circle width="2.5rem" height="2.5rem" />
              <Skeleton height="1rem" width="12rem" />
            </div>
          </div>
        </div>
      </div>

      <div className="gallery-grid">
        <div className="gallery-panel">
          <h3 className="gallery-panel__title">Loading state</h3>
          <div className="gallery-row">
            <Spinner label="Loading" />
            <span className="gallery-muted">Loading data with a labelled spinner.</span>
          </div>
        </div>
        <div className="gallery-panel">
          <h3 className="gallery-panel__title">Error state</h3>
          <div className="gallery-stack">
            <Alert tone="error">The request failed. Check your connection and try again.</Alert>
            <Button variant="ghost" size="sm" onClick={() => toast.info("Retrying…")}>
              Retry
            </Button>
          </div>
        </div>
        <div className="gallery-panel">
          <h3 className="gallery-panel__title">Empty state</h3>
          <EmptyState
            title="No results"
            description="Clear the filters to see every project again."
            action={
              <Button variant="ghost" size="sm">
                Clear filters
              </Button>
            }
          />
        </div>
      </div>

      <div className="gallery-panel">
        <h3 className="gallery-panel__title">Toasts</h3>
        <div className="gallery-row">
          {TOAST_TONES.map((tone) => (
            <Button
              key={tone}
              variant="ghost"
              size="sm"
              onClick={() => toast[tone]("A " + tone + " toast dismisses itself after 4 seconds.")}
            >
              {tone}
            </Button>
          ))}
        </div>
      </div>
    </Section>
  );
}
