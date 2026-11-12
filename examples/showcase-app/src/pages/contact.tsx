import { Clock, Mail, MapPin } from "lucide-react";
import { useState, type FormEvent } from "react";
import { PageHero } from "../components/page-hero.tsx";
import { Button } from "../components/ui/button.tsx";
import { Card } from "../components/ui/card.tsx";
import { Field, Input, Select, Textarea } from "../components/ui/field.tsx";
import { t } from "../lib/i18n.tsx";

const INFO = [
  { icon: Mail, labelKey: "contact.info.email", valueKey: "footer.email" },
  { icon: MapPin, labelKey: "contact.info.address", valueKey: "contact.info.address.value" },
  { icon: Clock, labelKey: "contact.info.hours", valueKey: "contact.info.hours.value" },
] as const;

export function ContactPage() {
  const [submitted, setSubmitted] = useState(false);

  // The template is frontend-only: the form validates and confirms locally, and wiring the
  // submit to an API is the documented next step.
  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setSubmitted(true);
  }

  return (
    <>
      <PageHero
        eyebrow={t("contact.hero.eyebrow")}
        title={t("contact.hero.title")}
        description={t("contact.hero.description")}
      />
      <section className="mx-auto grid w-full max-w-6xl gap-12 px-5 py-20 lg:grid-cols-[0.85fr_1.15fr]">
        <div className="flex flex-col gap-8">
          <h2 className="font-serif text-2xl tracking-tight">{t("contact.info.title")}</h2>
          <dl className="flex flex-col gap-6">
            {INFO.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.labelKey} className="flex gap-3">
                  <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-accent" />
                  <div className="flex flex-col gap-0.5">
                    <dt className="text-xs tracking-[0.14em] text-muted-foreground uppercase">
                      {t(item.labelKey)}
                    </dt>
                    <dd className="text-foreground">{t(item.valueKey)}</dd>
                  </div>
                </div>
              );
            })}
          </dl>
        </div>
        <Card className="gap-6 p-6 sm:p-8">
          <h2 className="font-serif text-2xl tracking-tight">{t("contact.form.title")}</h2>
          <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
            <Field label={t("contact.form.name")} htmlFor="contact-name">
              <Input
                id="contact-name"
                name="name"
                autoComplete="name"
                required
                placeholder={t("contact.form.name.placeholder")}
              />
            </Field>
            <Field label={t("contact.form.email")} htmlFor="contact-email">
              <Input
                id="contact-email"
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder={t("contact.form.email.placeholder")}
              />
            </Field>
            <Field label={t("contact.form.budget")} htmlFor="contact-budget">
              <Select id="contact-budget" name="budget" defaultValue="mid">
                <option value="low">{t("contact.form.budget.low")}</option>
                <option value="mid">{t("contact.form.budget.mid")}</option>
                <option value="high">{t("contact.form.budget.high")}</option>
              </Select>
            </Field>
            <Field label={t("contact.form.message")} htmlFor="contact-message">
              <Textarea
                id="contact-message"
                name="message"
                rows={5}
                required
                placeholder={t("contact.form.message.placeholder")}
              />
            </Field>
            <div className="flex flex-col gap-3">
              <Button type="submit" size="lg" className="self-start">
                {t("contact.form.submit")}
              </Button>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t("contact.form.note")}
              </p>
              {submitted ? (
                <p role="status" className="rounded-lg bg-accent/10 px-4 py-3 text-sm text-accent">
                  {t("contact.form.success")}
                </p>
              ) : null}
            </div>
          </form>
        </Card>
      </section>
    </>
  );
}
