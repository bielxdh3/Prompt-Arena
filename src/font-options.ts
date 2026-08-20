export type FontOption = {
  id: string;
  label: string;
  stack: string;
};

// System fonts keep the app offline and make missing fonts an explicit fallback,
// especially on Linux where Times New Roman is commonly unavailable.
export const FONT_OPTIONS: readonly FontOption[] = [
  {
    id: "times",
    label: "Times New Roman",
    stack: '"Times New Roman", "Liberation Serif", "Nimbus Roman", "DejaVu Serif", serif',
  },
  { id: "georgia", label: "Georgia", stack: 'Georgia, "Liberation Serif", serif' },
  { id: "garamond", label: "Garamond", stack: 'Garamond, "EB Garamond", "Liberation Serif", serif' },
  { id: "arial", label: "Arial", stack: 'Arial, "Liberation Sans", sans-serif' },
  { id: "verdana", label: "Verdana", stack: 'Verdana, "DejaVu Sans", sans-serif' },
  { id: "trebuchet", label: "Trebuchet MS", stack: '"Trebuchet MS", "Liberation Sans", sans-serif' },
  { id: "mono", label: "System Mono", stack: 'ui-monospace, "DejaVu Sans Mono", monospace' },
];

export const DEFAULT_FONT_ID = FONT_OPTIONS[0].id;

export function getFontOption(id: string): FontOption {
  return FONT_OPTIONS.find((option) => option.id === id) ?? FONT_OPTIONS[0];
}
