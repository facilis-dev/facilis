// The lens context providers (issues #72, #69): one wrap for every meaning lens whose card
// marks or inspector sections read settings through context. Split from ProjectGraphPanel so
// the composition root stays under the 300-line source limit; a lens with a stable null context
// keeps its cards subscription-free while inactive.

import type { ReactNode } from "react";
import { ContractLensContext, type ContractLensContextValue } from "./ProjectGraphContractMarks";
import { RuntimeLensContext, type RuntimeLensContextValue } from "./ProjectGraphRuntimeMarks";

export function ProjectGraphLensProviders({
  runtime,
  contract,
  children,
}: {
  runtime: RuntimeLensContextValue | null;
  contract: ContractLensContextValue | null;
  children: ReactNode;
}) {
  return (
    <RuntimeLensContext.Provider value={runtime}>
      <ContractLensContext.Provider value={contract}>{children}</ContractLensContext.Provider>
    </RuntimeLensContext.Provider>
  );
}
