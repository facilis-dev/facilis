// Italian form of en-state-lenses.ts. It may land incrementally; a missing key falls
// back to English (see it.ts).
import type { MessageKey } from "./index";

export const stateLensesIt: Partial<Record<MessageKey, string>> = {
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

  // ── changes lens (#200) ─────────────────────────────────────────────────────
  "projectGraph.surface.lens.changes": "Q19 · Modifiche",
  "projectGraph.surface.lens.changes.short": "Q19",
  "projectGraph.surface.lens.changes.description":
    "Il working tree rispetto al checkpoint (HEAD): i file modificati, aggiunti ed eliminati vengono mappati sui nodi che li possiedono. Sola lettura.",
  "projectGraph.surface.state.noChanges": "Il working tree corrisponde al checkpoint.",
  "projectGraph.surface.state.noChanges.label": "Nessuna modifica",
  "projectGraph.surface.state.fileModified": "Modificato dal checkpoint: {path}.",
  "projectGraph.surface.state.fileModified.label": "Modificato",
  "projectGraph.surface.state.fileModified.short": "M",
  "projectGraph.surface.state.fileAdded": "Aggiunto dal checkpoint: {path}.",
  "projectGraph.surface.state.fileAdded.label": "Aggiunto",
  "projectGraph.surface.state.fileAdded.short": "A",
  "projectGraph.surface.state.fileDeleted": "Eliminato dal checkpoint: {path}.",
  "projectGraph.surface.state.fileDeleted.label": "Eliminato",
  "projectGraph.surface.state.fileDeleted.short": "D",
  "projectGraph.surface.state.changes.totals":
    "{count} file cambiati · {modified} modificati · {added} aggiunti · {deleted} eliminati",
  "projectGraph.surface.state.changes.base": "vs {ref}",
  "projectGraph.surface.state.changes.loading": "Lettura del working tree…",
  "projectGraph.surface.state.changes.emptyTitle": "Nessuna modifica",
  "projectGraph.surface.state.changes.emptyHint":
    "Modifica un file sorgente o lascia che l'agente ne scriva uno: i nodi che li possiedono si illuminano qui. Nulla viene committato.",
  "projectGraph.surface.state.noRepo":
    "Questo progetto non è un repository git, quindi non c'è un checkpoint da confrontare.",
  "projectGraph.surface.state.changes.error": "Impossibile leggere il working tree.",
  "projectGraph.surface.state.noHead":
    "Questo repository non ha ancora un commit, quindi non c'è un checkpoint da confrontare.",

  // ── reach lens (#201) ───────────────────────────────────────────────────────
  "projectGraph.surface.lens.reach": "Q20 · Raggiungibilità",
  "projectGraph.surface.lens.reach.short": "Q20",
  "projectGraph.surface.lens.reach.description":
    "Cosa può chiamare un ruolo dichiarato: le route sbloccate dai suoi permessi, le pagine che le raggiungono e le tabelle che dichiarano. Sola lettura.",
  "projectGraph.surface.state.noRoles":
    "facilis.config.ts non dichiara ruoli, quindi non c'è nulla da raggiungere.",
  "projectGraph.surface.state.noRoles.label": "Nessun ruolo",
  "projectGraph.surface.state.publicRoute":
    "Route pubblica: non richiede permessi, quindi ogni ruolo la raggiunge.",
  "projectGraph.surface.state.publicRoute.label": "Route pubblica",
  "projectGraph.surface.state.publicRoute.short": "PUB",
  "projectGraph.surface.state.reachableRoute": "Raggiungibile con {permission}.",
  "projectGraph.surface.state.reachableRoute.label": "Route raggiungibile",
  "projectGraph.surface.state.undeclaredPermission":
    "Richiede {permission}, che nessun ruolo dichiarato possiede.",
  "projectGraph.surface.state.undeclaredPermission.label": "Permesso non dichiarato",
  "projectGraph.surface.state.undeclaredPermission.short": "?",
  "projectGraph.surface.state.wildcardRole":
    "Il ruolo {role} ha il wildcard, quindi si espande a ogni permesso dichiarato.",
  "projectGraph.surface.state.wildcardRole.label": "Ruolo wildcard",
  "projectGraph.surface.state.elevatedRoute":
    "Raggiunge i dati anche tramite elevazione sudo/system auditata.",
  "projectGraph.surface.state.elevatedRoute.label": "Accesso elevato",
  "projectGraph.surface.state.elevatedRoute.short": "SUDO",
  "projectGraph.surface.state.noReach": "Nessuna route è raggiungibile con i permessi di {role}.",
  "projectGraph.surface.state.noReach.label": "Nessuna route raggiungibile",
  "projectGraph.surface.state.reach.totals": "route: {count} · pagine: {pages} · tabelle: {tables}",
  "projectGraph.surface.state.reach.context": "Ruolo {role}",
  "projectGraph.surface.state.reach.role": "Ruolo",
  "projectGraph.surface.state.reach.emptyHint":
    "Scegli un altro ruolo o dichiara il permesso mancante in facilis.config.ts.",
};
