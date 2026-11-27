// Tab-moves-focus strings (issue #210). Monaco's flag has no public getter, so the IDE keeps
// its own copy of the state and says it out loud: the same words label the palette row and the
// status-bar announcement. A per-feature catalogue because en.ts is at its line cap.
export const a11yEn = {
  "a11y.tabFocus.on": "Tab moves focus: on",
  "a11y.tabFocus.off": "Tab moves focus: off",
} as const;
