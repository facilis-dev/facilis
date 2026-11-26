// The narrow IDE shell at 390x844 (issue #195), and the run gate that goes with it.
//
// Runs in its OWN tab, emulated mobile from the first paint: switching the viewport of
// the desktop run would remount the preview frame (the two shells are different trees),
// reload the running app and poison the console-error probe that main run carries. A
// second tab is also the honest shape of the check — a phone never "resizes" from a
// desktop.
//
// No install and no dev server: the project is created with "Install and run" off, which
// is the narrow shell's default too, and the Run control is exercised only far enough to
// prove it ASKS before starting anything.
import path from "node:path";
import { openPage } from "./cdp.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const PROJECT_DIR = "/home/user/projects/facilis-mobile-smoke";

export async function runMobileChecks({ client, devUrl, check, ARTIFACTS }) {
  const checks = [];
  const record = (ok, label, detail = "") => {
    check(ok, label, detail);
    checks.push({ ok, label, detail });
  };
  const waitFor = async (page, expression, limitMs) => {
    const until = Date.now() + limitMs;
    while (Date.now() < until) {
      if (await page.evaluate(expression)) return true;
      await sleep(250);
    }
    return false;
  };

  const page = await openPage(client, devUrl);
  await page.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    mobile: true,
  });
  await page.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });

  const ready = await waitFor(
    page,
    "Boolean(window.__ide && window.__ide.getSnapshot().kernelReady)",
    180000,
  );
  record(ready, "mobile: kernel online in the mobile tab");
  if (!ready) return { checks };

  await page.evaluate(
    `window.__ide.createProject({ dir: ${JSON.stringify(PROJECT_DIR)}, runInit: false, template: "todo" })`,
  );
  const graphOpen = await waitFor(
    page,
    "(() => { const s = window.__ide.getSnapshot(); return s.activeTab !== null && s.tabKinds[s.activeTab] === 'project-graph'; })()",
    60000,
  );
  record(graphOpen, "mobile: creating a project lands on the graph");
  // The project is created without a dev server, which is the point of the narrow shell.
  record(
    await page.evaluate(
      "window.__ide.getSnapshot().runTerminalId === null && window.__ide.getSnapshot().runPhase === null",
    ),
    "mobile: no dev server was started by creating the project",
  );

  const layout = () =>
    page.evaluate(`(() => {
      const rect = (selector) => {
        const el = document.querySelector(selector);
        if (!el) return null;
        const box = el.getBoundingClientRect();
        return {
          left: Math.round(box.left),
          right: Math.round(box.right),
          height: Math.round(box.height),
        };
      };
      return {
        width: window.innerWidth,
        editor: rect('[data-tour="editor"]'),
        sidebar: rect('[data-tour="sidebar"]'),
        preview: rect('[data-tour="preview"]'),
        nav: rect('[data-slot="mobile-shell-nav"]'),
        overflow: document.documentElement.scrollWidth > window.innerWidth,
      };
    })()`);

  const clickNav = (index) =>
    page.evaluate(
      `document.querySelectorAll('[data-slot="mobile-shell-nav"] button')[${index}].click()`,
    );

  const initial = await layout();
  record(initial.width === 390, "mobile: viewport is 390px", String(initial.width));
  record(!initial.overflow, "mobile: no horizontal document overflow");
  record(Boolean(initial.nav && initial.nav.height > 0), "mobile: bottom navigation visible");
  record(
    Boolean(initial.editor && initial.editor.height > 0),
    "mobile: the centre panel is rendered",
  );
  record(
    Boolean(initial.editor) &&
      initial.editor.height > 0 &&
      initial.editor.right <= initial.width &&
      initial.editor.left >= 0,
    "mobile: the centre panel fits the viewport",
    JSON.stringify(initial.editor) + " of " + initial.width,
  );
  record(initial.sidebar === null, "mobile: the sidebar starts collapsed");
  record(
    initial.preview === null || initial.preview.height === 0,
    "mobile: the preview starts collapsed",
  );
  await page.screenshot(path.join(ARTIFACTS, "10-mobile-code.png"));

  // The drawer: the bottom navigation's first destination.
  await clickNav(0);
  await sleep(300);
  const drawer = await layout();
  record(
    Boolean(drawer.sidebar && drawer.sidebar.height > 0),
    "mobile: the sidebar opens as a drawer",
  );
  record(
    Boolean(drawer.sidebar) && drawer.sidebar.right <= drawer.width && drawer.sidebar.left >= 0,
    "mobile: the drawer fits the viewport",
  );
  await page.screenshot(path.join(ARTIFACTS, "10-mobile-drawer.png"));

  await clickNav(0);
  await sleep(200);
  await clickNav(2);
  await sleep(400);
  const preview = await layout();
  record(
    Boolean(preview.preview && preview.preview.height > 0),
    "mobile: the preview opens as a surface",
  );
  record(
    Boolean(preview.preview) && preview.preview.right <= preview.width,
    "mobile: the preview fits the viewport",
  );

  // The run gate: Run on a touch device must ask before spending the tab's memory.
  await page.evaluate(`window.__ide.runProject(${JSON.stringify(PROJECT_DIR)})`);
  const asked = await waitFor(
    page,
    "document.body.innerText.includes('Start the dev server on this device?')",
    20000,
  );
  record(asked, "mobile: Run asks before starting the dev server");
  record(
    await page.evaluate(
      "window.__ide.getSnapshot().runTerminalId === null && window.__ide.getSnapshot().runPhase === null",
    ),
    "mobile: nothing starts before the answer",
  );
  await page.screenshot(path.join(ARTIFACTS, "10-mobile-run-confirm.png"));

  const declined = await page.evaluate(
    "(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.innerText || '').trim() === 'Not now');" +
      " if (!b) return 'NOTFOUND'; b.click(); return 'OK'; })()",
  );
  await sleep(400);
  record(declined === "OK", "mobile: the prompt offers a way out", declined);
  record(
    !(await page.evaluate(
      "document.body.innerText.includes('Start the dev server on this device?')",
    )),
    "mobile: declining dismisses the prompt",
  );
  record(
    await page.evaluate(
      "window.__ide.getSnapshot().runTerminalId === null && window.__ide.getSnapshot().runPhase === null",
    ),
    "mobile: declining starts nothing",
  );

  await clickNav(1);
  await sleep(300);
  const back = await layout();
  record(
    Boolean(back.editor && back.editor.height > 0 && back.editor.right <= back.width),
    "mobile: Code returns to the centre panel",
  );

  return { checks };
}
