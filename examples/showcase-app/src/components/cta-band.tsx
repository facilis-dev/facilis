import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { t } from "../lib/i18n.tsx";
import { buttonClass } from "./ui/button.tsx";

export function CtaBand() {
  return (
    <section className="mx-auto w-full max-w-6xl px-5 pb-20">
      <div className="relative overflow-hidden rounded-3xl bg-primary px-6 py-14 text-primary-foreground sm:px-12 sm:py-16">
        <span
          aria-hidden="true"
          className="absolute -top-24 -right-16 size-72 rounded-full bg-accent/30 blur-2xl"
        />
        <div className="relative flex max-w-xl flex-col items-start gap-6">
          <h2 className="font-serif text-3xl leading-tight tracking-tight text-balance sm:text-4xl">
            {t("home.cta.title")}
          </h2>
          <p className="text-primary-foreground/75">{t("home.cta.description")}</p>
          <Link className={buttonClass({ variant: "accent", size: "lg" })} to="/contact">
            {t("home.cta.action")}
            <ArrowRight />
          </Link>
        </div>
      </div>
    </section>
  );
}
