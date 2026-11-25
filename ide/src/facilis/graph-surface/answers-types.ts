// Typed answer rows for the project-graph inspector (epic #182, issue #190). The inspector's
// sections are pure projections of the already-memoized graph dataset: a row names its target
// node when clicking it navigates, and carries data labels only — every semantic label and
// empty state is an i18n key resolved by the components (D-043).

import type { GraphDiagnostic, GraphNodeKind } from "@facilis.dev/analyze";
import type { I18nParams } from "@facilis.dev/core/i18n";
import type { MessageKey } from "@/i18n";
import type { NodeDetails } from "../graph-details";
import type { ProjectGraphEdge, ProjectGraphNode, ProjectGraphView } from "../graph-types";

export type GraphAnswerId =
  "q1" | "q2" | "q3" | "q4" | "q5" | "q6" | "q7" | "q8" | "q9" | "q10" | "q16" | "q17";

/** A graph kind, plus the non-node facts an answer may list (a policy, an input schema...). */
export type GraphAnswerKind = GraphNodeKind | "policy" | "input" | "source" | "unknown";

export type GraphAnswerAccess = "read" | "write" | "read-write";

export interface GraphAnswerSource {
  readonly file: string;
  /** null when only the node's source file is known, not the declaring line. */
  readonly line: number | null;
}

export interface GraphAnswerRow {
  readonly key: string;
  /** The node a click navigates to; null when the row is a non-navigable fact. */
  readonly nodeId: string | null;
  /** The data label (node, policy or file name); ignored when labelKey is set. */
  readonly label: string;
  readonly labelKey: MessageKey | null;
  readonly labelParams: I18nParams | null;
  readonly kind: GraphAnswerKind;
  readonly domain: string | null;
  readonly access: GraphAnswerAccess | null;
  readonly detail: string | null;
  readonly detailKey: MessageKey | null;
  readonly detailParams: I18nParams | null;
  /** Non-null on a Q16 row: clicking opens the file at this line. */
  readonly source: GraphAnswerSource | null;
  /** Domain heading for grouped sections (Q8/Q9/Q10); null renders a flat row. */
  readonly group: string | null;
}

export interface GraphAnswerSummary {
  readonly key: MessageKey;
  readonly params: I18nParams | null;
}

export interface GraphAnswerSection {
  readonly id: GraphAnswerId;
  readonly titleKey: MessageKey;
  readonly emptyKey: MessageKey;
  readonly summary: GraphAnswerSummary | null;
  readonly rows: readonly GraphAnswerRow[];
  readonly groupByDomain: boolean;
}

/** Everything the answer functions read, indexed once per dataset. */
export interface GraphAnswerContext {
  readonly view: ProjectGraphView;
  readonly details: ReadonlyMap<string, NodeDetails>;
  readonly diagnostics: readonly GraphDiagnostic[];
  readonly byId: ReadonlyMap<string, ProjectGraphNode>;
  readonly domainOf: ReadonlyMap<string, string>;
  readonly outgoing: ReadonlyMap<string, readonly ProjectGraphEdge[]>;
  readonly incoming: ReadonlyMap<string, readonly ProjectGraphEdge[]>;
}

export const ACCESS_MESSAGE_KEYS: Readonly<Record<GraphAnswerAccess, MessageKey>> = {
  read: "projectGraph.surface.answers.read",
  write: "projectGraph.surface.answers.write",
  "read-write": "projectGraph.surface.answers.readWrite",
};

export const KIND_MESSAGE_KEYS: Readonly<Record<GraphAnswerKind, MessageKey>> = {
  page: "projectGraph.node.page",
  route: "projectGraph.node.route",
  table: "projectGraph.node.table",
  view: "projectGraph.node.view",
  workflow: "projectGraph.node.workflow",
  policy: "projectGraph.surface.answers.kind.policy",
  input: "projectGraph.surface.answers.kind.input",
  source: "projectGraph.surface.answers.kind.source",
  unknown: "projectGraph.surface.answers.kind.unknown",
};
