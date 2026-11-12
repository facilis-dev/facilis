// The template picker opened when scaffolding an empty repository (D-080), spread
// into `en` in en.ts. Its own module because en.ts is at the 300-line limit and the
// dialog's keys do not belong to the git-network block (en-git-remote.ts) either.
export const scaffoldEn = {
  "scaffoldDialog.title": "Create the project",
  "scaffoldDialog.description":
    "Choose the template to write into this folder. Files already in it, like the README, are kept.",
  "scaffoldDialog.confirm": "Create project",
} as const;
