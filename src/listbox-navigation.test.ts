import { describe, expect, it } from "vitest";
import { calculateListboxMenuPosition } from "./accessible-listbox";
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
    expect(listboxNavigation({ key: " ", currentIndex: 2, optionCount: 3, open: true })).toEqual({ action: "select", index: 2 });
    expect(listboxNavigation({ key: "Spacebar", currentIndex: 1, optionCount: 3, open: true })).toEqual({ action: "select", index: 1 });
    expect(listboxNavigation({ key: "Escape", currentIndex: 1, optionCount: 3, open: true })).toEqual({ action: "close", index: 1 });
    expect(listboxNavigation({ key: "PageDown", currentIndex: 1, optionCount: 3, open: true })).toEqual({ action: "none", index: 1 });
  });

  it("starts from a safe option when focus has no valid index", () => {
    expect(listboxNavigation({ key: "ArrowDown", currentIndex: -1, optionCount: 3, open: true })).toEqual({ action: "move", index: 1 });
    expect(listboxNavigation({ key: "ArrowUp", currentIndex: 9, optionCount: 3, open: true })).toEqual({ action: "move", index: 2 });
  });

  it("does nothing for disabled and empty listboxes", () => {
    expect(listboxNavigation({ key: "ArrowDown", currentIndex: 0, optionCount: 3, open: false, disabled: true })).toEqual({ action: "none", index: -1 });
    expect(listboxNavigation({ key: "Enter", currentIndex: 0, optionCount: 0, open: false })).toEqual({ action: "none", index: -1 });
    expect(listboxNavigation({ key: "Escape", currentIndex: 0, optionCount: 0, open: true })).toEqual({ action: "none", index: -1 });
  });
});

describe("listbox viewport placement", () => {
  it("prefers below placement at the top and middle of the page", () => {
    expect(calculateListboxMenuPosition({ top: 48, bottom: 88, left: 40, width: 240 }, { width: 1280, height: 900 })).toMatchObject({
      placement: "below",
      top: 96,
      maxHeight: 280,
    });
    expect(calculateListboxMenuPosition({ top: 390, bottom: 430, left: 40, width: 240 }, { width: 1280, height: 900 })).toMatchObject({
      placement: "below",
      top: 438,
    });
  });

  it("opens above near the bottom without overlapping the trigger", () => {
    const position = calculateListboxMenuPosition({ top: 740, bottom: 780, left: 40, width: 240 }, { width: 1280, height: 800 });
    expect(position.placement).toBe("above");
    expect(position.top + position.maxHeight).toBe(732);
    expect(position.top).toBeGreaterThanOrEqual(12);
  });

  it("clamps width and height to narrow viewport space", () => {
    const position = calculateListboxMenuPosition({ top: 2, bottom: 30, left: -20, width: 420 }, { width: 220, height: 120 });
    expect(position.left).toBe(12);
    expect(position.width).toBe(196);
    expect(position.top).toBeGreaterThanOrEqual(12);
    expect(position.top + position.maxHeight).toBeLessThanOrEqual(108);
  });
});
