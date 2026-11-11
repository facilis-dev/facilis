import { analyzeDirectory } from "../src/node.ts";

const root = process.argv.slice(2).find((argument) => argument !== "--");
if (root === undefined) {
  console.error("usage: pnpm --filter @facilis.dev/analyze analyze -- <project-dir>");
  process.exitCode = 1;
} else {
  const analysis = analyzeDirectory(root);
  const graph = analysis.graph;
  console.log(
    JSON.stringify(
      {
        revision: analysis.revision,
        files: analysis.files.length,
        routes: analysis.routes.length,
        tables: analysis.tables.length,
        relations: analysis.relations.length,
        pages: analysis.pages.filter((page) => page.calls.length > 0).length,
        graph: { nodes: graph.nodes.length, edges: graph.edges.length },
        diagnostics: analysis.diagnostics.length,
      },
      null,
      2,
    ),
  );
}
