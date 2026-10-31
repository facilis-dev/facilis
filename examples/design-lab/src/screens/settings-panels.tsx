import { useState, type FormEvent } from "react";
import { Button, Field, Input, Select, Textarea, toast } from "@facilis/ui";
import { Avatar } from "../components/bits.tsx";
import { Card } from "../components/card.tsx";
import { Switch } from "../components/switch.tsx";
import { currentUser, notificationSettings, type NotificationSetting } from "../data.ts";

function submitProfile(event: FormEvent<HTMLFormElement>): void {
  event.preventDefault();
  toast.success("Profile updated");
}

export function ProfilePanel() {
  return (
    <Card
      title="Profile"
      description="This is how you appear to the rest of the workspace."
      footer={
        <>
          <Button variant="ghost" onClick={() => toast.info("Changes discarded")}>
            Cancel
          </Button>
          <Button type="submit" form="profile-form">
            Save changes
          </Button>
        </>
      }
    >
      <form className="lab-form" id="profile-form" onSubmit={submitProfile}>
        <div className="lab-profile-head">
          <Avatar name={currentUser.name} size="lg" />
          <div className="lab-profile-head__meta">
            <p className="lab-setting__title">{currentUser.name}</p>
            <p className="lab-hint">Head of Product · Northwind Studio</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => toast.info("Photo upload is out of scope for the lab")}
          >
            Change photo
          </Button>
        </div>
        <div className="lab-form__grid">
          <Field label="First name">
            <Input defaultValue="Giulia" />
          </Field>
          <Field label="Last name">
            <Input defaultValue="Ferri" />
          </Field>
          <Field label="Work email">
            <Input type="email" defaultValue={currentUser.email} />
          </Field>
          <Field label="Job title">
            <Input defaultValue="Head of Product" />
          </Field>
          <Field label="Bio" className="lab-form__full" hint="A short line for your team profile.">
            <Textarea
              rows={3}
              defaultValue="Product lead at Northwind Studio. I care about calm tools and clear handoffs."
            />
          </Field>
          <Field label="Timezone">
            <Select defaultValue="cet">
              <option value="cet">Central European Time (UTC+01:00)</option>
              <option value="gmt">Greenwich Mean Time (UTC+00:00)</option>
              <option value="est">Eastern Time (UTC−05:00)</option>
            </Select>
          </Field>
          <Field label="Language">
            <Select defaultValue="en">
              <option value="en">English</option>
              <option value="it">Italiano</option>
            </Select>
          </Field>
        </div>
      </form>
      <hr className="lab-divider" />
      <div className="lab-form__row">
        <div>
          <p className="lab-setting__title">Two-factor authentication</p>
          <p className="lab-setting__desc">Require a one-time code when signing in.</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => toast.info("Two-factor setup is out of scope for the lab")}
        >
          Enable
        </Button>
      </div>
    </Card>
  );
}

export function NotificationsPanel() {
  const [settings, setSettings] = useState<readonly NotificationSetting[]>(notificationSettings);

  function toggle(id: string, checked: boolean): void {
    setSettings((previous) =>
      previous.map((setting) => (setting.id === id ? { ...setting, checked } : setting)),
    );
  }

  return (
    <Card
      title="Notifications"
      description="Choose what lands in your inbox. Critical security alerts can be muted only by an owner."
      footer={
        <Button onClick={() => toast.success("Notification preferences saved")}>
          Save preferences
        </Button>
      }
    >
      <div className="lab-setting-list">
        {settings.map((setting) => (
          <div className="lab-setting" key={setting.id}>
            <div>
              <p className="lab-setting__title">{setting.title}</p>
              <p className="lab-setting__desc">{setting.description}</p>
            </div>
            <Switch
              label={setting.title}
              checked={setting.checked}
              onChange={(checked) => toggle(setting.id, checked)}
            />
          </div>
        ))}
      </div>
    </Card>
  );
}
