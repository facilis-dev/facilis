// The impact simulation lens's Italian catalogue (issue #74), split like its English twin for
// the 300-line source limit; partial by design, a missing key falls back to English.

import type { MessageKey } from "./index";

export const projectGraphImpactIt: Partial<Record<MessageKey, string>> = {
  "projectGraph.impact.label": "Simulazione impatto",
  "projectGraph.impact.section": "Simulazione impatto",
  "projectGraph.impact.simulate": "Simula rimozione",
  "projectGraph.impact.simulateHint":
    "Anteprima di cosa si rompe se questa tabella o vista viene rimossa — il modello non viene mai modificato (Esc per uscire)",
  "projectGraph.impact.stop": "Ferma simulazione",
  "projectGraph.impact.exit": "Esci dalla simulazione impatto",
  "projectGraph.impact.exitHint": "Ripristina la vista precedente (Esc)",
  "projectGraph.impact.counts": "{routes} route, {views} viste",
  "projectGraph.impact.hint": "Seleziona una tabella per simularne la rimozione",
  "projectGraph.impact.simulating": "rimozione simulata",
  "projectGraph.impact.simulatingHint":
    "Simulato come rimosso: i dipendenti mantengono il colore, il resto si attenua — nulla viene modificato",
  "projectGraph.impact.neverRead": "mai letta",
  "projectGraph.impact.neverReadHint":
    "Nessuna route legge questa tabella, direttamente o tramite una vista",
  "projectGraph.impact.routes": "Route interessate",
  "projectGraph.impact.methodRoutes": "Route {method}",
  "projectGraph.impact.noDependents": "Nessuna route dipende da questa selezione.",
  "projectGraph.impact.columns": "Impatto a livello di colonna",
  "projectGraph.impact.columnNotAnalysed": "l'impatto a livello di colonna non è analizzato",
  "projectGraph.impact.columnNoDependents": "Nessuna route dichiara questa colonna.",
  "projectGraph.impact.simulateColumn": "Simula la rimozione della colonna {column}",
  "projectGraph.impact.stopColumn": "Ferma la simulazione della colonna {column}",
};
