/**
 * The showcase content as plain data: cards, stats and projects reference catalogue keys
 * instead of literals, so a copy change never touches a component.
 */

export type IconName = "compass" | "layers" | "palette" | "gauge" | "shield" | "sparkles";

export type Feature = {
  readonly icon: IconName;
  readonly titleKey: string;
  readonly bodyKey: string;
};

export const FEATURES: readonly Feature[] = [
  { icon: "palette", titleKey: "feature.identity.title", bodyKey: "feature.identity.body" },
  { icon: "layers", titleKey: "feature.digital.title", bodyKey: "feature.digital.body" },
  { icon: "compass", titleKey: "feature.editorial.title", bodyKey: "feature.editorial.body" },
  { icon: "sparkles", titleKey: "feature.motion.title", bodyKey: "feature.motion.body" },
  { icon: "gauge", titleKey: "feature.strategy.title", bodyKey: "feature.strategy.body" },
  { icon: "shield", titleKey: "feature.systems.title", bodyKey: "feature.systems.body" },
];

export type Stat = {
  readonly value: string;
  readonly labelKey: string;
};

export const STATS: readonly Stat[] = [
  { value: "120+", labelKey: "home.stats.projects" },
  { value: "48", labelKey: "home.stats.clients" },
  { value: "9", labelKey: "home.stats.awards" },
];

export type ProjectTone = "ember" | "ink" | "paper";

export type Project = {
  readonly titleKey: string;
  readonly categoryKey: string;
  readonly year: string;
  readonly tone: ProjectTone;
};

export const PROJECTS: readonly Project[] = [
  {
    titleKey: "project.lumen.title",
    categoryKey: "project.lumen.category",
    year: "2026",
    tone: "ember",
  },
  {
    titleKey: "project.verde.title",
    categoryKey: "project.verde.category",
    year: "2025",
    tone: "paper",
  },
  {
    titleKey: "project.atlas.title",
    categoryKey: "project.atlas.category",
    year: "2025",
    tone: "ink",
  },
  {
    titleKey: "project.notte.title",
    categoryKey: "project.notte.category",
    year: "2024",
    tone: "ink",
  },
  {
    titleKey: "project.forma.title",
    categoryKey: "project.forma.category",
    year: "2024",
    tone: "ember",
  },
  {
    titleKey: "project.terra.title",
    categoryKey: "project.terra.category",
    year: "2023",
    tone: "paper",
  },
];

export type ProcessStep = {
  readonly titleKey: string;
  readonly bodyKey: string;
};

export const PROCESS_STEPS: readonly ProcessStep[] = [
  { titleKey: "features.process.1.title", bodyKey: "features.process.1.body" },
  { titleKey: "features.process.2.title", bodyKey: "features.process.2.body" },
  { titleKey: "features.process.3.title", bodyKey: "features.process.3.body" },
];
