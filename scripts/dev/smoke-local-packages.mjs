// Dev local-packages acceptance checks for scripts/dev/smoke-ide.mjs (issue #41, D-196).
//
// A dev build installs the workspace @facilis.dev/* packages from the IDE origin into the
// project VFS (vendor/facilis/) with file: deps, instead of npm. These checks prove the
// path end to end in the WebContainer: the dev route serves an index, the created project
// pins file: specs, the vendored manifest rewrites internal deps to file:../<sibling>, and
// no @facilis.dev/* request reaches the npm registry during install. The kernel installs
// from inside Web Workers, so the registry assertion reads cdp.downloads(), which instruments
// the auto-attached worker targets (scripts/dev/cdp.mjs).

/** Run the local-packages checks against the created project. Returns { checks }. */
export async function runLocalPackagesChecks({ page, devUrl }) {
  const checks = [];
  const record = (ok, label, detail = "") => {
    checks.push({ ok, label, detail });
    console.log((ok ? "PASS " : "FAIL ") + label + (detail ? "  " + detail : ""));
  };

  // 1. The dev-only route serves a package index (absent from a production build).
  const indexResponse = await page.evaluate(
    "fetch(" +
      JSON.stringify(devUrl + "__facilis/dev/packages/index.json") +
      ").then(async (r) => ({ status: r.status, body: await r.text() }))",
  );
  let index = null;
  try {
    index = JSON.parse(indexResponse.body);
  } catch {
    /* not JSON — the route is missing or answered the SPA fallback */
  }
  const packageCount = Array.isArray(index?.packages) ? index.packages.length : 0;
  record(
    indexResponse.status === 200 && packageCount > 0,
    "local packages dev index served",
    "HTTP " + indexResponse.status + ", " + packageCount + " packages",
  );

  // 2. The created project pins every framework package to a file: vendor spec.
  const root = await page.evaluate("window.__ide.activeFolder?.rootPath || ''");
  const packageText = await page.evaluate(
    "window.__ide.readFileText(" +
      JSON.stringify(root + "/package.json") +
      ").then((t) => String(t)).catch(() => '')",
  );
  let manifest = null;
  try {
    manifest = JSON.parse(packageText);
  } catch {
    /* unreadable — the project was not created */
  }
  const frameworkDeps = Object.entries(manifest?.dependencies ?? {}).filter(([name]) =>
    name.startsWith("@facilis.dev/"),
  );
  const allLocal =
    frameworkDeps.length > 0 &&
    frameworkDeps.every(([, spec]) => spec.startsWith("file:./vendor/facilis/"));
  record(
    allLocal,
    "created project pins file: vendor deps",
    frameworkDeps.length + " framework deps",
  );

  // 3. The vendored copy exists and its internal deps resolve to the sibling copies.
  const vendorText = await page.evaluate(
    "window.__ide.readFileText(" +
      JSON.stringify(root + "/vendor/facilis/nitro/package.json") +
      ").then((t) => String(t)).catch(() => '')",
  );
  let vendor = null;
  try {
    vendor = JSON.parse(vendorText);
  } catch {
    /* missing vendor copy */
  }
  const internalDeps = Object.entries(vendor?.dependencies ?? {}).filter(([name]) =>
    name.startsWith("@facilis.dev/"),
  );
  const internalLocal =
    internalDeps.length > 0 && internalDeps.every(([, spec]) => spec.startsWith("file:../"));
  record(
    Boolean(vendor) && internalLocal,
    "vendor copy present with file:../ internal deps",
    vendor?.name ?? "missing",
  );

  // 4. No framework package is fetched from npm: the install resolved the local copies.
  const registryFramework = page
    .downloads()
    .filter(
      (request) => /registry\.npmjs\.org/.test(request.url) && /facilis\.dev/.test(request.url),
    );
  record(
    registryFramework.length === 0,
    "no @facilis.dev/* request reaches npm",
    registryFramework
      .map((request) => request.url)
      .join(", ")
      .slice(0, 200),
  );

  return { checks };
}
