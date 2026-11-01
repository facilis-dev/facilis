import { useState } from "react";
import { Combobox, DatePicker, Field, TagPicker } from "@facilis/ui";
import { Section } from "./section.tsx";

const OWNERS = [
  { value: "ada", label: "Ada Lovelace", hint: "Engineering" },
  { value: "grace", label: "Grace Hopper", hint: "Platform" },
  { value: "alan", label: "Alan Turing", hint: "Research" },
  { value: "barbara", label: "Barbara Liskov", hint: "Data" },
] as const;

const TAG_OPTIONS = ["react", "vue", "svelte", "astro", "solid"] as const;

export function FormsSection() {
  const [startDate, setStartDate] = useState<Date | null>(new Date(2026, 0, 15));
  const [sessionStart, setSessionStart] = useState<Date | null>(new Date(2026, 0, 15, 9, 30));
  const [owner, setOwner] = useState<string | null>("ada");
  const [tags, setTags] = useState<readonly string[]>(["react", "typescript"]);

  return (
    <Section
      id="forms"
      title="Advanced forms"
      description="Date, datetime, searchable select and tag input. All four are controlled, keyboard-complete and wrapped here in Field so their label, hint and aria wiring come from the kit."
    >
      <div className="gallery-grid">
        <Field label="Start date" hint="Local Date value; serialize with @facilis/time.">
          <DatePicker value={startDate} onChange={setStartDate} locale="en" />
        </Field>

        <Field label="Session start" hint="Date plus time in 24-hour selects.">
          <DatePicker value={sessionStart} onChange={setSessionStart} mode="datetime" locale="en" />
        </Field>

        <Field label="Owner" hint="Search by name or value.">
          <Combobox
            options={OWNERS}
            value={owner}
            onChange={setOwner}
            placeholder="Choose an owner…"
          />
        </Field>

        <Field label="Tags" hint="Enter or comma commits; Backspace removes the last chip.">
          <TagPicker
            value={tags}
            onChange={(next) => setTags(next)}
            options={TAG_OPTIONS}
            placeholder="Add a tag…"
            removeLabel={(tag) => "Remove " + tag}
          />
        </Field>
      </div>
    </Section>
  );
}
