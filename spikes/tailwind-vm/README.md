# Spike — Tailwind v4 + Base UI (shadcn substrate) in the WebContainer

Temporary experiment, not shipped. run.mjs patches examples/todo-app and the
template's install command for the duration of the run and restores them in finally.

It answers the gate question from the UI review: can a generated Facilis project run the
shadcn substrate (Tailwind CSS v4 + Base UI) inside the IDE's WebContainer?

Run: node spikes/tailwind-vm/run.mjs

Artifacts land in $FACILIS_TOOLING_DIR/spike-tailwind-vm/<timestamp>/ (report.json,
terminal.txt, downloads.json, screenshots).
