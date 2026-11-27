// The notebook cell's accessible name (issue #210): mountCellEditor passes this as Monaco's
// ariaLabel, and it has to count from one and say which kind of cell it is. The mount itself
// needs Monaco and a DOM; the naming rule is pure, so that is what is asserted here.

import { beforeEach, describe, expect, it } from "vitest";
import { initI18n, setLocale } from "@/i18n";
import { cellAriaLabel } from "./cell-mount";

beforeEach(() => {
  initI18n();
  setLocale("en");
});

describe("cellAriaLabel", () => {
  it("counts cells from one and names the kind", () => {
    expect(cellAriaLabel("code", 0, 12)).toBe("Code cell 1 of 12");
    expect(cellAriaLabel("code", 2, 12)).toBe("Code cell 3 of 12");
    expect(cellAriaLabel("markdown", 2, 12)).toBe("Markdown cell 3 of 12");
  });

  it("speaks the IDE's language", () => {
    setLocale("it");
    expect(cellAriaLabel("code", 0, 3)).toBe("Cella di codice 1 di 3");
  });
});
