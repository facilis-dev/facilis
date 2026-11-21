// The impact lens's context (issue #74): the satellite section renders inside the inspector body,
// which is composed for the canvas satellite, the pinned cards, the bottom sheet AND matrix mode
// (F.7). Threading one provider keeps every one of those surfaces in sync without adding a prop
// to four intermediate components — the same pattern as the runtime lens (#72).
//
// null = the lens is unavailable (a standalone inspector render); the section then stays out.

import { createContext } from "react";
import type { ProjectGraphImpact } from "./useProjectGraphImpact";

export const ImpactLensContext = createContext<ProjectGraphImpact | null>(null);
