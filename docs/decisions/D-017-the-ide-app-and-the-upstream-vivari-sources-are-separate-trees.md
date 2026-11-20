# D-017 — The IDE app and the upstream Vivari sources are separate trees
**Status:** superseded by D-018 and D-019

Vendoring Vivari as one tree under `studio/` left a second npm workspace root inside the repo
(`studio/packages/studio` = app, `studio/packages/*` = kernel, `studio/{scripts,worker,examples}`
in neither), so the tree was partitioned by role. D-018 then made the upstream half a real
git clone (submodule) instead of a copied tree, and renamed the app folder to `ide/`; D-019
brought that app under the repository's own toolchain. The split itself stands: one upstream
tree, one app tree, no duplicated files.
