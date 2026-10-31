import { AuthShell, Button, Checkbox, Field, Input, toast } from "@facilis/ui";
import { AvatarStack } from "../components/bits.tsx";
import { users } from "../data.ts";
import { IconCheck, IconExternal, IconLogo } from "../icons.tsx";

const HIGHLIGHTS = [
  "Every project with its owner, status and latest activity",
  "Weekly digests instead of status meetings",
  "Audit-ready history for security reviews",
];

function preventNavigation(event: { preventDefault: () => void }): void {
  event.preventDefault();
}

/** Split auth: restrained brand panel on the left, kit AuthShell + form on the right. */
export function AuthScreen() {
  return (
    <div className="lab-auth-screen">
      <section className="lab-auth-brand" aria-label="About Facilis">
        <div className="lab-auth-brand__top">
          <span className="lab-logo lab-logo--inverse">
            <IconLogo size={16} />
          </span>
          <span className="lab-auth-brand__name">Facilis</span>
        </div>
        <div className="lab-auth-brand__body">
          <p className="lab-auth-brand__eyebrow">Operations workspace</p>
          <h1 className="lab-auth-brand__title">The calm place to run every project.</h1>
          <p className="lab-auth-brand__copy">
            Status, owners and delivery live in one workspace, so the weekly review takes minutes
            instead of a morning.
          </p>
          <ul className="lab-auth-brand__list">
            {HIGHLIGHTS.map((highlight) => (
              <li key={highlight}>
                <IconCheck size={14} />
                {highlight}
              </li>
            ))}
          </ul>
        </div>
        <div className="lab-auth-brand__foot">
          <AvatarStack names={users.slice(0, 5).map((user) => user.name)} max={4} />
          <p>Trusted by 40+ product teams</p>
        </div>
      </section>

      <section className="lab-auth-panel">
        <AuthShell
          title="Sign in to Facilis"
          subtitle="Continue to the Northwind workspace."
          footer={
            <p className="lab-auth-footer">
              New to Facilis?{" "}
              <a className="lab-link" href="#create-account" onClick={preventNavigation}>
                Create an account
              </a>
            </p>
          }
        >
          <form
            className="lab-form"
            onSubmit={(event) => {
              event.preventDefault();
              toast.success("Welcome back, Giulia.");
            }}
          >
            <Field label="Work email">
              <Input
                type="email"
                name="email"
                autoComplete="email"
                defaultValue="giulia@northwind.studio"
              />
            </Field>
            <Field label="Password">
              <Input
                type="password"
                name="password"
                autoComplete="current-password"
                placeholder="Enter your password"
              />
            </Field>
            <div className="lab-form__row">
              <label className="lab-check">
                <Checkbox defaultChecked />
                Remember me for 30 days
              </label>
              <a className="lab-link" href="#forgot-password" onClick={preventNavigation}>
                Forgot password?
              </a>
            </div>
            <Button type="submit" className="lab-btn--block">
              Sign in
            </Button>
            <Button
              variant="ghost"
              className="lab-btn--block"
              onClick={() => toast.info("SSO is available on the Scale plan")}
            >
              <IconExternal size={14} />
              Continue with SSO
            </Button>
          </form>
        </AuthShell>
        <p className="lab-auth-panel__legal">
          By continuing you agree to the Terms of Service and Privacy Policy.
        </p>
      </section>
    </div>
  );
}
