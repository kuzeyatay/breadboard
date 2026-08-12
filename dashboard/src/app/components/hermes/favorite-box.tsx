"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { createPortal } from "react-dom";

export const DEFAULT_CAPABILITY_HIGHLIGHT_COLOR = "#b8cec0";

export const CAPABILITY_HIGHLIGHT_COLORS = [
  { value: "#b8cec0", name: "Sage" },
  { value: "#ffbf19", name: "Amber" },
  { value: "#ef7180", name: "Coral" },
  { value: "#ff6b0b", name: "Orange" },
  { value: "#1fbd66", name: "Green" },
  { value: "#17b6a4", name: "Teal" },
  { value: "#27afe5", name: "Sky" },
  { value: "#5798e8", name: "Blue" },
  { value: "#9a82e6", name: "Lavender" },
  { value: "#e760a7", name: "Pink" },
  { value: "#9ae72b", name: "Lime" },
] as const;

export function capabilityHighlightStyle(color: string | null | undefined): CSSProperties | undefined {
  if (!color) return undefined;
  return {
    backgroundColor: `${color}22`,
    boxShadow: `inset 3px 0 0 ${color}`,
  };
}

type PalettePosition = { left: number; top: number };

// Rounded-square highlight control shared across the capability palette. The
// square always represents a color; it never changes into checkbox imagery.
export default function FavoriteBox({
  color,
  onColorChange,
  label,
}: {
  color?: string | null;
  onColorChange: (color: string | null) => void;
  label: string;
}) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<PalettePosition>({ left: 12, top: 12 });

  const placePalette = useCallback(() => {
    const rectangle = anchorRef.current?.getBoundingClientRect();
    if (!rectangle) return;
    const width = 184;
    const estimatedHeight = color ? 164 : 132;
    const left = Math.min(
      Math.max(12, rectangle.right - width),
      Math.max(12, window.innerWidth - width - 12),
    );
    const top = rectangle.bottom + 8 + estimatedHeight <= window.innerHeight
      ? rectangle.bottom + 8
      : Math.max(12, rectangle.top - estimatedHeight - 8);
    setPosition({ left, top });
  }, [color]);

  function togglePalette(event: ReactMouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    placePalette();
    setOpen((current) => !current);
  }

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (anchorRef.current?.contains(target) || paletteRef.current?.contains(target)) return;
      setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      anchorRef.current?.focus();
    };
    const reposition = () => placePalette();
    document.addEventListener("pointerdown", closeOutside, true);
    document.addEventListener("keydown", closeOnEscape, true);
    window.addEventListener("resize", reposition);
    return () => {
      document.removeEventListener("pointerdown", closeOutside, true);
      document.removeEventListener("keydown", closeOnEscape, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open, placePalette]);

  const palette = open && typeof document !== "undefined"
    ? createPortal(
        <div
          ref={paletteRef}
          role="dialog"
          aria-label="Choose highlight color"
          className="neu-popover fixed z-[100] w-[184px] rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] p-3 text-[var(--ink)]"
          style={position}
          onClick={(event) => event.stopPropagation()}
        >
          <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--ink-muted)]">
            Highlight color
          </p>
          <div className="grid grid-cols-6 gap-2">
            {CAPABILITY_HIGHLIGHT_COLORS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onColorChange(option.value);
                  setOpen(false);
                  anchorRef.current?.focus();
                }}
                aria-label={`Highlight with ${option.name}`}
                aria-pressed={color === option.value}
                title={option.name}
                className="h-5 w-5 rounded-[5px] border border-[var(--line-strong)] transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--botanical)]"
                style={{
                  backgroundColor: option.value,
                  boxShadow: color === option.value ? "0 0 0 2px var(--paper-raised), 0 0 0 4px var(--botanical)" : undefined,
                }}
              />
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            {color ? (
              <button
                type="button"
                onClick={() => {
                  onColorChange(null);
                  setOpen(false);
                  anchorRef.current?.focus();
                }}
                className="neu-button flex-1 rounded-lg border border-[var(--line)] px-2 py-1.5 text-[10px] text-[var(--ink-muted)]"
              >
                Remove
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                anchorRef.current?.focus();
              }}
              className="neu-button flex-1 rounded-lg border border-[var(--line)] px-2 py-1.5 text-[10px] text-[var(--ink)]"
            >
              Close
            </button>
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={togglePalette}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        title={color ? "Change highlight color" : "Choose highlight color"}
        className="mr-2 h-5 w-5 shrink-0 rounded-md border border-[var(--line-strong)] bg-[var(--paper-raised)] transition hover:border-[var(--botanical)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--botanical)]"
        style={color ? { backgroundColor: color } : undefined}
      />
      {palette}
    </>
  );
}
