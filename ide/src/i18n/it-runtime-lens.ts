// Italian form of en-runtime-lens.ts. It may land incrementally; a missing key falls
// back to English (see it.ts).
import type { MessageKey } from "./index";

export const runtimeLensIt: Partial<Record<MessageKey, string>> = {
  "projectGraph.surface.lens.runtime": "Q18 · Runtime",
  "projectGraph.surface.lens.runtime.short": "Q18",
  "projectGraph.surface.lens.runtime.description":
    "Campioni per route dal preview in esecuzione: richieste, tasso 5xx e latenza p50/p95. Solo in una build di sviluppo.",

  "projectGraph.surface.state.notRunning.label": "Non in esecuzione",
  "projectGraph.surface.state.noTraffic":
    "Nessuna richiesta ha raggiunto una route negli ultimi {minutes} minuti.",
  "projectGraph.surface.state.noTraffic.label": "Nessun traffico",
  "projectGraph.surface.state.routeErrors":
    "{errors} richieste su {total} sono fallite con un 5xx ({rate}%).",
  "projectGraph.surface.state.routeErrors.label": "Errori server",
  "projectGraph.surface.state.slowRoute":
    "La p95 è {p95} ms, sopra la soglia di {threshold} ms per una route lenta.",
  "projectGraph.surface.state.slowRoute.label": "Route lenta",
  "projectGraph.surface.state.title": "Segnali live",
  "projectGraph.surface.state.badge": "{requests} rich · {errors} err",
  "projectGraph.surface.state.totals": "{count} richieste · {errors} errori",
  "projectGraph.surface.state.window": "Ultimi {minutes} minuti",
  "projectGraph.surface.state.devOnly":
    "I campioni runtime esistono solo in una build di sviluppo.",
  "projectGraph.surface.state.emptyTitle": "Nessun traffico",
  "projectGraph.surface.state.emptyHint":
    "Apri il preview e invia una richiesta, oppure ricarica una pagina: le card delle route si popolano entro un secondo.",
};
