// The lens context providers (issues #72, #69): one wrap for every meaning lens whose card
// marks or inspector sections read settings through context. Split from ProjectGraphPanel so
// the composition root stays under the 300-line source limit; a lens with a stable null context
// keeps its cards subscription-free while inactive.

import type { ReactNode } from "react";
import { ContractLensContext, type ContractLensContextValue } from "./ProjectGraphContractMarks";
import { ImpactLensContext } from "./ProjectGraphImpactContext";
import { RuntimeLensContext, type RuntimeLensContextValue } from "./ProjectGraphRuntimeMarks";
import type { ProjectGraphImpact } from "./useProjectGraphImpact";

export function ProjectGraphLensProviders({
  runtime,
  contract,
  impact,
  children,
}: {
  runtime: RuntimeLensContextValue | null;
  contract: ContractLensContextValue | null;
  /** The impact simulation (issue #74): its satellite section and HUD line read it here. */
  impact: ProjectGraphImpact;
  children: ReactNode;
}) {
  return (
    <RuntimeLensContext.Provider value={runtime}>
      <ContractLensContext.Provider value={contract}>
        <ImpactLensContext.Provider value={impact}>{children}</ImpactLensContext.Provider>
      </ContractLensContext.Provider>
    </RuntimeLensContext.Provider>
  );
}
