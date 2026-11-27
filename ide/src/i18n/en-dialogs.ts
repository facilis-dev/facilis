// Dialog feedback strings (issue #219), spread into `en` in en.ts.
//
// The catalogue is at the 300-line limit, so this block lives in its own module: the
// reasons a field is invalid and the copy/unlock actions a dialog announces as text.
export const dialogsEn = {
  "delete.confirmMismatch": "Type {name} exactly to confirm the delete.",
  "reset.confirmMismatch": "Type {word} exactly to confirm the reset.",
  "import.kernelStarting": "The runtime is still starting — importing unlocks in a moment.",
  "github.copyCode": "Copy code",
  "github.copied": "Code copied",
} as const;
