// The inspector's answer sections (epic #182, issue #190): one typed section per graph question,
// built from the already-memoized dataset. The builder only chooses which questions apply to the
// selected node; every row comes from the pure answer functions and every label is an i18n key.
import type { GraphDiagnostic } from "@facilis.dev/analyze";
import type { MessageKey } from "@/i18n";
import type { NodeDetails } from "../graph-details";
import type { ProjectGraphNode, ProjectGraphView } from "../graph-types";
import { createAnswerContext } from "./answers-context";
import {
  elevatedRoutes,
  pagesOfRoute,
  relationsOfPage,
  routeOverviewRows,
  routesOfPage,
} from "./answers-questions";
import type { GraphAnswerContext, GraphAnswerId, GraphAnswerSection } from "./answers-types";
import {
  externalReferences,
  impactIfDropped,
  nodeSource,
  sharedGroups,
  tableSecurityRows,
  tableSecuritySummary,
  tableUsageRows,
  unknownFacts,
} from "./answers-usage";

interface SectionInput {
  readonly id: GraphAnswerId;
  readonly titleKey: MessageKey;
  readonly emptyKey: MessageKey;
  readonly rows: GraphAnswerSection["rows"];
  readonly groupByDomain?: boolean;
  readonly summary?: GraphAnswerSection["summary"];
}

function section(input: SectionInput): GraphAnswerSection {
  return {
    id: input.id,
    titleKey: input.titleKey,
    emptyKey: input.emptyKey,
    summary: input.summary ?? null,
    rows: input.rows,
    groupByDomain: input.groupByDomain ?? false,
  };
}

function pageSections(node: ProjectGraphNode, ctx: GraphAnswerContext): GraphAnswerSection[] {
  return [
    section({
      id: "q1",
      titleKey: "projectGraph.surface.answers.q1",
      emptyKey: "projectGraph.surface.answers.empty.q1",
      rows: routesOfPage(node, ctx),
    }),
    section({
      id: "q3",
      titleKey: "projectGraph.surface.answers.q3",
      emptyKey: "projectGraph.surface.answers.empty.q3",
      rows: relationsOfPage(node, ctx),
    }),
    section({
      id: "q4",
      titleKey: "projectGraph.surface.lens.elevated",
      emptyKey: "projectGraph.surface.answers.empty.q4",
      rows: elevatedRoutes(node, ctx),
    }),
    section({
      id: "q8",
      titleKey: "projectGraph.surface.answers.q8",
      emptyKey: "projectGraph.surface.answers.empty.q8",
      rows: externalReferences(node, ctx),
      groupByDomain: true,
    }),
    section({
      id: "q9",
      titleKey: "projectGraph.surface.answers.q9",
      emptyKey: "projectGraph.surface.answers.empty.q9",
      rows: sharedGroups(node, ctx),
      groupByDomain: true,
    }),
    section({
      id: "q10",
      titleKey: "projectGraph.surface.answers.q10",
      emptyKey: "projectGraph.surface.answers.empty.q10",
      rows: impactIfDropped(node, ctx),
      groupByDomain: true,
    }),
    section({
      id: "q16",
      titleKey: "projectGraph.surface.answers.q16",
      emptyKey: "projectGraph.surface.answers.empty.q16",
      rows: nodeSource(node, ctx),
    }),
    section({
      id: "q17",
      titleKey: "projectGraph.surface.lens.unknown",
      emptyKey: "projectGraph.surface.answers.empty.q17",
      rows: unknownFacts(node, ctx),
    }),
  ];
}

function routeSections(node: ProjectGraphNode, ctx: GraphAnswerContext): GraphAnswerSection[] {
  return [
    section({
      id: "q2",
      titleKey: "projectGraph.surface.answers.q2",
      emptyKey: "projectGraph.surface.answers.empty.q2",
      rows: pagesOfRoute(node, ctx),
    }),
    section({
      id: "q4",
      titleKey: "projectGraph.surface.lens.elevated",
      emptyKey: "projectGraph.surface.answers.empty.q4",
      rows: elevatedRoutes(node, ctx),
    }),
    section({
      id: "q6",
      titleKey: "projectGraph.surface.answers.q6",
      emptyKey: "projectGraph.surface.answers.empty.q6",
      rows: routeOverviewRows(node, ctx),
    }),
    section({
      id: "q8",
      titleKey: "projectGraph.surface.answers.q8",
      emptyKey: "projectGraph.surface.answers.empty.q8",
      rows: externalReferences(node, ctx),
      groupByDomain: true,
    }),
    section({
      id: "q9",
      titleKey: "projectGraph.surface.answers.q9",
      emptyKey: "projectGraph.surface.answers.empty.q9",
      rows: sharedGroups(node, ctx),
      groupByDomain: true,
    }),
    section({
      id: "q10",
      titleKey: "projectGraph.surface.answers.q10",
      emptyKey: "projectGraph.surface.answers.empty.q10",
      rows: impactIfDropped(node, ctx),
      groupByDomain: true,
    }),
    section({
      id: "q16",
      titleKey: "projectGraph.surface.answers.q16",
      emptyKey: "projectGraph.surface.answers.empty.q16",
      rows: nodeSource(node, ctx),
    }),
    section({
      id: "q17",
      titleKey: "projectGraph.surface.lens.unknown",
      emptyKey: "projectGraph.surface.answers.empty.q17",
      rows: unknownFacts(node, ctx),
    }),
  ];
}

function tableSections(node: ProjectGraphNode, ctx: GraphAnswerContext): GraphAnswerSection[] {
  return [
    section({
      id: "q5",
      titleKey: "projectGraph.surface.answers.q5",
      emptyKey: "projectGraph.surface.answers.empty.q5",
      rows: tableSecurityRows(node, ctx),
      summary: tableSecuritySummary(node),
    }),
    section({
      id: "q7",
      titleKey: "projectGraph.surface.answers.q7",
      emptyKey: "projectGraph.surface.answers.empty.q7",
      rows: tableUsageRows(node, ctx),
    }),
    section({
      id: "q8",
      titleKey: "projectGraph.surface.answers.q8",
      emptyKey: "projectGraph.surface.answers.empty.q8",
      rows: externalReferences(node, ctx),
      groupByDomain: true,
    }),
    section({
      id: "q9",
      titleKey: "projectGraph.surface.answers.q9",
      emptyKey: "projectGraph.surface.answers.empty.q9",
      rows: sharedGroups(node, ctx),
      groupByDomain: true,
    }),
    section({
      id: "q10",
      titleKey: "projectGraph.surface.answers.q10",
      emptyKey: "projectGraph.surface.answers.empty.q10",
      rows: impactIfDropped(node, ctx),
      groupByDomain: true,
    }),
    section({
      id: "q16",
      titleKey: "projectGraph.surface.answers.q16",
      emptyKey: "projectGraph.surface.answers.empty.q16",
      rows: nodeSource(node, ctx),
    }),
    section({
      id: "q17",
      titleKey: "projectGraph.surface.lens.unknown",
      emptyKey: "projectGraph.surface.answers.empty.q17",
      rows: unknownFacts(node, ctx),
    }),
  ];
}

function viewSections(node: ProjectGraphNode, ctx: GraphAnswerContext): GraphAnswerSection[] {
  return [
    section({
      id: "q8",
      titleKey: "projectGraph.surface.answers.q8",
      emptyKey: "projectGraph.surface.answers.empty.q8",
      rows: externalReferences(node, ctx),
      groupByDomain: true,
    }),
    section({
      id: "q9",
      titleKey: "projectGraph.surface.answers.q9",
      emptyKey: "projectGraph.surface.answers.empty.q9",
      rows: sharedGroups(node, ctx),
      groupByDomain: true,
    }),
    section({
      id: "q10",
      titleKey: "projectGraph.surface.answers.q10",
      emptyKey: "projectGraph.surface.answers.empty.q10",
      rows: impactIfDropped(node, ctx),
      groupByDomain: true,
    }),
    section({
      id: "q16",
      titleKey: "projectGraph.surface.answers.q16",
      emptyKey: "projectGraph.surface.answers.empty.q16",
      rows: nodeSource(node, ctx),
    }),
    section({
      id: "q17",
      titleKey: "projectGraph.surface.lens.unknown",
      emptyKey: "projectGraph.surface.answers.empty.q17",
      rows: unknownFacts(node, ctx),
    }),
  ];
}

function workflowSections(node: ProjectGraphNode, ctx: GraphAnswerContext): GraphAnswerSection[] {
  return [
    section({
      id: "q10",
      titleKey: "projectGraph.surface.answers.q10",
      emptyKey: "projectGraph.surface.answers.empty.q10",
      rows: impactIfDropped(node, ctx),
      groupByDomain: true,
    }),
    section({
      id: "q16",
      titleKey: "projectGraph.surface.answers.q16",
      emptyKey: "projectGraph.surface.answers.empty.q16",
      rows: nodeSource(node, ctx),
    }),
    section({
      id: "q17",
      titleKey: "projectGraph.surface.lens.unknown",
      emptyKey: "projectGraph.surface.answers.empty.q17",
      rows: unknownFacts(node, ctx),
    }),
  ];
}

/** The sections the inspector shows for one node, in question order. */
export function buildNodeAnswerSections(
  node: ProjectGraphNode,
  ctx: GraphAnswerContext,
): readonly GraphAnswerSection[] {
  if (node.data.kind === "page") return pageSections(node, ctx);
  if (node.data.kind === "route") return routeSections(node, ctx);
  if (node.data.kind === "table") return tableSections(node, ctx);
  if (node.data.kind === "view") return viewSections(node, ctx);
  return workflowSections(node, ctx);
}

/** Build the context and the sections in one call (tests and the panel share it). */
export function buildNodeAnswers(
  node: ProjectGraphNode,
  view: ProjectGraphView,
  details: ReadonlyMap<string, NodeDetails>,
  diagnostics: readonly GraphDiagnostic[],
): readonly GraphAnswerSection[] {
  return buildNodeAnswerSections(node, createAnswerContext(view, details, diagnostics));
}
