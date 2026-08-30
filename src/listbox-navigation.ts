export type ListboxNavigationAction = "none" | "open" | "move" | "select" | "close";

export type ListboxNavigationResult = {
  action: ListboxNavigationAction;
  index: number;
};

type ListboxNavigationInput = {
  key: string;
  currentIndex: number;
  optionCount: number;
  open: boolean;
  disabled?: boolean;
};

function validIndex(currentIndex: number, optionCount: number): number {
  return currentIndex >= 0 && currentIndex < optionCount ? currentIndex : 0;
}

export function listboxNavigation({
  key,
  currentIndex,
  optionCount,
  open,
  disabled = false,
}: ListboxNavigationInput): ListboxNavigationResult {
  if (disabled || optionCount === 0) return { action: "none", index: -1 };

  const index = validIndex(currentIndex, optionCount);
  if (!open) {
    if (key === "ArrowDown" || key === "Home") return { action: "open", index: 0 };
    if (key === "ArrowUp" || key === "End") return { action: "open", index: optionCount - 1 };
    if (key === "Enter" || key === " " || key === "Spacebar") return { action: "open", index };
    return { action: "none", index };
  }

  if (key === "ArrowDown") return { action: "move", index: (index + 1) % optionCount };
  if (key === "ArrowUp") return { action: "move", index: (index - 1 + optionCount) % optionCount };
  if (key === "Home") return { action: "move", index: 0 };
  if (key === "End") return { action: "move", index: optionCount - 1 };
  if (key === "Enter" || key === " " || key === "Spacebar") return { action: "select", index };
  if (key === "Escape") return { action: "close", index };
  return { action: "none", index };
}
