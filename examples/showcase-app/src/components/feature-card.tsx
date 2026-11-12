import {
  Compass,
  Gauge,
  Layers,
  Palette,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import type { Feature, IconName } from "../lib/content.ts";
import { t } from "../lib/i18n.tsx";
import { Card, CardDescription, CardTitle } from "./ui/card.tsx";

const ICONS: Record<IconName, LucideIcon> = {
  compass: Compass,
  gauge: Gauge,
  layers: Layers,
  palette: Palette,
  shield: ShieldCheck,
  sparkles: Sparkles,
};

export function FeatureCard({ feature }: { feature: Feature }) {
  const Icon = ICONS[feature.icon];

  return (
    <Card className="gap-4 p-6">
      <span className="grid size-11 place-items-center rounded-xl bg-accent/10 text-accent">
        <Icon aria-hidden="true" className="size-5" />
      </span>
      <CardTitle>{t(feature.titleKey)}</CardTitle>
      <CardDescription className="leading-relaxed">{t(feature.bodyKey)}</CardDescription>
    </Card>
  );
}
