import { useEffect, useState } from "react";
import { Button, Toaster, toast } from "@facilis/ui";
import { ComponentsSection } from "./gallery-components.tsx";
import { ContentSection } from "./gallery-content.tsx";
import { FeedbackSection } from "./gallery-feedback.tsx";
import { FormsSection } from "./gallery-forms.tsx";
import { FoundationSection } from "./gallery-foundation.tsx";
import { PatternsSection } from "./gallery-patterns.tsx";
import { TemplatesSection } from "./gallery-templates.tsx";

type Theme = "light" | "dark";

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
          <p className="gallery-eyebrow">Direction A · Institutional</p>
          <h1 className="gallery-title">Facilis UI kit</h1>
          <p className="gallery-lead">
            Every token, primitive and pattern on one page. The surface is driven only by the role
            variables in theme.css; the toggle flips the complete light and dark sets.
          </p>
        </div>
        <div className="gallery-header__actions">
          <Button variant="ghost" onClick={() => toast.info("Toasts dismiss after 4 seconds.")}>
            Show toast
          </Button>
          <Button
            variant="secondary"
            onClick={() => setTheme((current) => (current === "light" ? "dark" : "light"))}
          >
            {theme === "light" ? "Switch to dark" : "Switch to light"}
          </Button>
        </div>
      </header>

      <FoundationSection />
      <ComponentsSection />
      <FormsSection />
      <ContentSection />
      <PatternsSection />
      <TemplatesSection />
      <FeedbackSection />

      <Toaster />
    </div>
  );
}
