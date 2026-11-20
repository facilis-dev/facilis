# D-160 — Le viste sono nodi del project graph, con le rotte che le usano
**Status:** accepted (2026-11-11)

**Context.** D-157 ha reso `dbTables` una dichiarazione applicata: una route elenca le relazioni che
può toccare, **tabelle e viste**, e per una vista dichiara il nome SQL della `defineView` (non le tabelle
base). Il grafo del progetto però mostrava solo pagine, route e tabelle: il "quale route fa cosa" era
visibile per le tabelle e invisibile per le viste, e O-013 lo teneva aperto. D-157 aveva rinviato
esplicitamente i nodi vista. L'owner ha chiesto di vedere le viste sul grafo e di capire quando le usano
le rotte.

**Decision.**

- **Fatti.** `@facilis.dev/analyze` aggiunge un nodo `view` al `ProjectGraph` per ogni `ViewFact`:
  id `view:<nome SQL>`, sorgente il file `db/views/**`, dati `ViewNodeData` (nome, tabelle base
  dichiarate, `permission`, `access` invoker/definer/ignoto, unknown). `analysis.views` resta la
  fonte dei fatti; il grafo ne è la proiezione.
- **Archi dalle rotte.** Una voce di `dbTables` che denota una vista produce un arco `route-view`
  (label `dbTables`, id `route-view:<route>:dbTables:<view>`), marcato `elevated` quando la vista è
  in `options.tables` di un'elevazione `ctx.sudo`/`ctx.system`, come già per le tabelle. La fonte è la
  **dichiarazione**, non l'uso osservato dal pass delle relazioni: D-157 rende la dichiarazione
  verificata e garantita a runtime, quindi dichiarazione e accesso non possono divergere senza un
  errore. I `dbColumns` restano solo delle tabelle (le viste non hanno fatti colonna).
- **Archi delle viste.** Le tabelle base dichiarate in `defineView.tables` (metadata informativa,
  D-097) producono archi `view-base` (id `view-base:<view>:<base>`), con target il nodo tabella o
  l'altra vista che esiste; una base non dichiarata staticamente non produce arco, e
  l'autoreferenza è ignorata.
- **IDE.** La vista è il quarto tipo di nodo e sta nella **colonna dello schema, sotto le tabelle**
  (non una colonna nuova: gli archi route→vista attraverserebbero la colonna delle tabelle). Il nodo
  mostra badge vista, modalità invoker/definer + permesso, tabelle base (collassabili) e "usata da N
  rotte"; l'inspector elenca le rotte che la usano; filtri/legenda/conteggi coprono i due nuovi tipi di
  arco. I nuovi tipi sono **in coda** a `GRAPH_EDGE_KINDS`, così l'ordine persistito di
  `hiddenEdges` non cambia per i layout esistenti (il formato file resta v3: un progetto senza viste
  produce un layout identico a prima).
- **Contratto.** `GraphNodeKind` guadagna `view` e `GraphEdgeKind` `route-view`/`view-base`:
  i consumer con switch esaustivi smettono di compilare, che è il comportamento voluto.

**Rejected.** Un flag "isView" sul nodo tabella (filtri, ricerca e inspector dovrebbero comunque
specializzarlo, e il contratto del grafo resterebbe ambiguo). Derivare route→vista dall'uso del pass AST
invece che da `dbTables` (seconda fonte di verità contro una dichiarazione già applicata). Una quarta
colonna di layout (gli archi route→vista passerebbero sopra le tabelle). Trattare le tabelle base di una
vista come accesso della route (D-157: sono metadata della vista, non accesso diretto).

**Consequences.** SPEC v1.28 §10.2/§11.2 e O-013 si aggiornano; il bullet "nodi vista" di D-157 resta
superato **solo per il grafo** (analyzer e validator invariati). Test: `graph.test.ts` (nodi e archi
vista) e i test del modello/layout del grafo IDE.

**Verification.** `pnpm --filter @facilis.dev/analyze test` (nodi, route-view, view-base, determinismo),
`pnpm --filter @facilis.dev/ide test` (dati, used-by-routes, posizionamento nella colonna schema, ricerca,
filtri), typecheck dei due pacchetti.
