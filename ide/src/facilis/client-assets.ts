// Styles + locale catalogue of the Facilis probe template.
//
// Split out of client-files.ts so that file stays inside the 300-line ratchet while the probe
// app there grows the database roundtrip it reports to the smoke.

export const clientStyles = `:root {
  font-family: system-ui, Avenir, Helvetica, Arial, sans-serif;
  line-height: 1.5;
  color-scheme: dark;
  color: rgba(255, 255, 255, 0.87);
  background-color: #101014;
}
body {
  margin: 0;
  display: grid;
  place-items: center;
  min-height: 100vh;
}
.page {
  width: 100%;
  max-width: 720px;
  padding: 2rem;
  box-sizing: border-box;
}
h1 {
  font-size: 2.2rem;
  margin: 0 0 0.25rem;
}
.tagline {
  color: #9ca3af;
  margin: 0 0 1.5rem;
}
.summary {
  list-style: none;
  padding: 0;
  margin: 0 0 1.5rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.9rem;
}
.summary li {
  background: #1b1b22;
  border: 1px solid #26262f;
  border-radius: 6px;
  padding: 0.35rem 0.6rem;
  margin-bottom: 0.35rem;
}
.muted {
  color: #6b7280;
  font-size: 0.85rem;
  margin: 0;
}
`;

export const clientLocales =
  JSON.stringify(
    {
      "app.title": "Facilis",
      "app.tagline": "A Facilis app running in the browser IDE.",
      "app.probing": "Probing the framework…",
      "app.hmr": "Edit src/App.tsx and save to test HMR.",
    },
    null,
    2,
  ) + "\n";
