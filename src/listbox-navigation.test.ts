import { describe, expect, it } from "vitest";
import { listboxNavigation } from "./listbox-navigation";

describe("listbox keyboard navigation", () => {
  it("opens from the trigger with directional, boundary, and selection keys", () => {
    expect(listboxNavigation({ key: "ArrowDown", currentIndex: 2, optionCount: 3, open: false })).toEqual({ action: "open", index: 0 });
    expect(listboxNavigation({ key: "ArrowUp", currentIndex: 0, optionCount: 3, open: false })).toEqual({ action: "open", index: 2 });
    expect(listboxNavigation({ key: "Home", currentIndex: 2, optionCount: 3, open: false })).toEqual({ action: "open", index: 0 });
    expect(listboxNavigation({ key: "End", currentIndex: 0, optionCount: 3, open: false })).toEqual({ action: "open", index: 2 });
    expect(listboxNavigation({ key: "Enter", currentIndex: 1, optionCount: 3, open: false })).toEqual({ action: "open", index: 1 });
    expect(listboxNavigation({ key: " ", currentIndex: -1, optionCount: 3, open: false })).toEqual({ action: "open", index: 0 });
  });

  it("moves, selects, and closes while open", () => {
    expect(listboxNavigation({ key: "ArrowDown", currentIndex: 2, optionCount: 3, open: true })).toEqual({ action: "move", index: 0 });
    expect(listboxNavigation({ key: "ArrowUp", currentIndex: 0, optionCount: 3, open: true })).toEqual({ action: "move", index: 2 });
    expect(listboxNavigation({ key: "Home", currentIndex: 2, optionCount: 3, open: true })).toEqual({ action: "move", index: 0 });
    expect(listboxNavigation({ key: "End", currentIndex: 0, optionCount: 3, open: true })).toEqual({ action: "move", index: 2 });
    expect(listboxNavigation({ key: "Enter", currentIndex: 1, optionCount: 3, open: true })).toEqual({ action: "select", index: 1 });
    expect(listboxNavigation({ key: "Spacebar", currentIndex: 1, optionCount: 3, open: true })).toEqual({ action: "select", index: 1 });
    expect(listboxNavigation({ key: "Escape", currentIndex: 1, optionCount: 3, open: true })).toEqual({ action: "close", index: 1 });
    expect(listboxNavigation({ key: "PageDown", currentIndex: 1, optionCount: 3, open: true })).toEqual({ action: "none", index: 1 });
  });

  it("does nothing for disabled and empty listboxes", () => {
    expect(listboxNavigation({ key: "ArrowDown", currentIndex: 0, optionCount: 3, open: false, disabled: true })).toEqual({ action: "none", index: -1 });
    expect(listboxNavigation({ key: "Enter", currentIndex: 0, optionCount: 0, open: false })).toEqual({ action: "none", index: -1 });
    expect(listboxNavigation({ key: "Escape", currentIndex: 0, optionCount: 0, open: true })).toEqual({ action: "none", index: -1 });
  });
});
