import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { listboxNavigation } from "./listbox-navigation";

export type AccessibleListboxOption = {
  value: string;
  label: string;
  detail?: string;
};

export function AccessibleListbox({
  id,
  label,
  value,
  options,
  placeholder,
  disabled = false,
  className = "",
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: readonly AccessibleListboxOption[];
  placeholder: string;
  disabled?: boolean;
  className?: string;
  onChange: (value: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLLIElement | null>>([]);
  const [open, setOpen] = useState(false);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const [activeIndex, setActiveIndex] = useState(selectedIndex >= 0 ? selectedIndex : options.length > 0 ? 0 : -1);
  const isDisabled = disabled || options.length === 0;
  const labelId = `${id}-label`;
  const valueId = `${id}-value`;
  const listboxId = `${id}-options`;

  useEffect(() => {
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : options.length > 0 ? 0 : -1);
  }, [options.length, selectedIndex]);

  useEffect(() => {
    if (open) optionRefs.current[activeIndex]?.focus();
  }, [activeIndex, open]);

  useEffect(() => {
    if (isDisabled) setOpen(false);
  }, [isDisabled]);

  useEffect(() => {
    if (!open) return;
    const handleOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", handleOutsidePointer);
    return () => document.removeEventListener("pointerdown", handleOutsidePointer);
  }, [open]);

  function closeAndFocusTrigger() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function selectOption(index: number) {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    closeAndFocusTrigger();
  }

  function handleRootBlur(event: FocusEvent<HTMLDivElement>) {
    if (event.relatedTarget instanceof Node && rootRef.current?.contains(event.relatedTarget)) return;
    setOpen(false);
  }

  function handleTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    const transition = listboxNavigation({ key: event.key, currentIndex: activeIndex, optionCount: options.length, open: false, disabled: isDisabled });
    if (transition.action === "none") return;
    event.preventDefault();
    setActiveIndex(transition.index);
    setOpen(true);
  }

  function handleOptionKeyDown(event: ReactKeyboardEvent<HTMLLIElement>) {
    const index = Number(event.currentTarget.dataset.index);
    const transition = listboxNavigation({ key: event.key, currentIndex: index, optionCount: options.length, open: true, disabled: isDisabled });
    if (transition.action === "none") return;
    event.preventDefault();
    if (transition.action === "move") setActiveIndex(transition.index);
    if (transition.action === "select") selectOption(transition.index);
    if (transition.action === "close") closeAndFocusTrigger();
  }

  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : undefined;
  return (
    <div className={`arena-select-control arena-custom-listbox ${className}`.trim()} ref={rootRef} onBlur={handleRootBlur}>
      <span className="field-label" id={labelId}>{label}</span>
      <button
        className="arena-listbox-trigger"
        id={`${id}-button`}
        ref={triggerRef}
        type="button"
        disabled={isDisabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-labelledby={`${labelId} ${valueId}`}
        onClick={() => {
          if (open) closeAndFocusTrigger();
          else {
            setActiveIndex(selectedIndex >= 0 ? selectedIndex : options.length > 0 ? 0 : -1);
            setOpen(true);
          }
        }}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="arena-listbox-value" id={valueId}>
          <strong>{selectedOption?.label ?? placeholder}</strong>
          {selectedOption?.detail && <small>{selectedOption.detail}</small>}
        </span>
        <span aria-hidden="true">⌄</span>
      </button>
      {open && (
        <ul className="arena-listbox-menu" id={listboxId} role="listbox" aria-labelledby={labelId}>
          {options.map((option, index) => (
            <li
              className={`arena-listbox-option ${index === selectedIndex ? "is-selected" : ""}`}
              data-index={index}
              id={`${listboxId}-${index}`}
              key={option.value}
              ref={(element) => { optionRefs.current[index] = element; }}
              role="option"
              aria-selected={index === selectedIndex}
              tabIndex={index === activeIndex ? 0 : -1}
              onClick={() => selectOption(index)}
              onKeyDown={handleOptionKeyDown}
            >
              <strong>{option.label}</strong>
              {option.detail && <small>{option.detail}</small>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
