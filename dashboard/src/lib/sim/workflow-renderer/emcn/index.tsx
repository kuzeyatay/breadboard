// Vendored from simstudioai/sim (Apache-2.0) — minimal @sim/emcn equivalents for the workflow-renderer views; adapted for Breadboard.
// Only the pieces the vendored views actually import are provided here, with
// the same props surface. Visuals follow sim's chip/badge/switch styling using
// the sim-canvas scoped CSS variables (see app/workflows/sim-canvas.css).
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type CSSProperties,
  type HTMLAttributes,
  type KeyboardEvent,
  type MouseEventHandler,
  type ReactNode,
} from "react";

type ClassValue = string | number | null | false | undefined | ClassValue[] | Record<string, boolean | null | undefined>;

function flatten(input: ClassValue, out: string[]): void {
  if (!input) return;
  if (typeof input === "string" || typeof input === "number") {
    out.push(String(input));
    return;
  }
  if (Array.isArray(input)) {
    for (const item of input) flatten(item, out);
    return;
  }
  for (const [key, active] of Object.entries(input)) {
    if (active) out.push(key);
  }
}

/**
 * Class combiner. Unlike sim's cn this does not run tailwind-merge (the
 * dependency is not installed); the vendored views only rely on clsx-style
 * conditional joining, where later classes simply append.
 */
export function cn(...inputs: ClassValue[]): string {
  const out: string[] = [];
  for (const input of inputs) flatten(input, out);
  return out.join(" ");
}

export function isKeyboardActivation(event: KeyboardEvent): boolean {
  return event.key === "Enter" || event.key === " ";
}

export function handleKeyboardActivation(
  event: KeyboardEvent,
  action: () => void,
  options: { stopPropagation?: boolean } = {},
): void {
  if (!isKeyboardActivation(event)) return;
  event.preventDefault();
  if (options.stopPropagation) event.stopPropagation();
  action();
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void) {
  const media = window.matchMedia(REDUCED_MOTION_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/** Whether the user has asked for reduced motion, as reactive state. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    useCallback(subscribeReducedMotion, []),
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false,
  );
}

/* ------------------------------------------------------------------ */
/* Tooltip — lightweight hover tooltip with the Radix-style compound API */
/* ------------------------------------------------------------------ */

type TooltipContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
};

const TooltipContext = createContext<TooltipContextValue | null>(null);

function TooltipRoot({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const value = useMemo(() => ({ open, setOpen }), [open]);
  return (
    <TooltipContext.Provider value={value}>
      <span className="relative inline-flex">{children}</span>
    </TooltipContext.Provider>
  );
}

function TooltipTrigger({ children }: { asChild?: boolean; children: ReactNode }) {
  const context = useContext(TooltipContext);
  return (
    <span
      className="inline-flex"
      onMouseEnter={() => context?.setOpen(true)}
      onMouseLeave={() => context?.setOpen(false)}
      onFocus={() => context?.setOpen(true)}
      onBlur={() => context?.setOpen(false)}
    >
      {children}
    </span>
  );
}

function TooltipContent({
  children,
  side = "top",
  className,
}: {
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
}) {
  const context = useContext(TooltipContext);
  if (!context?.open) return null;
  const placement =
    side === "bottom"
      ? "top-full mt-1.5 left-1/2 -translate-x-1/2"
      : side === "left"
        ? "right-full mr-1.5 top-1/2 -translate-y-1/2"
        : side === "right"
          ? "left-full ml-1.5 top-1/2 -translate-y-1/2"
          : "bottom-full mb-1.5 left-1/2 -translate-x-1/2";
  return (
    <span
      role="tooltip"
      className={cn(
        "pointer-events-none absolute z-[3000] w-max max-w-[240px] rounded-md bg-[var(--text-primary)] px-2 py-1 text-[var(--surface-2)] text-xs shadow-md",
        placement,
        className,
      )}
    >
      {children}
    </span>
  );
}

export const Tooltip = {
  Root: TooltipRoot,
  Trigger: TooltipTrigger,
  Content: TooltipContent,
};

/* ------------------------------------------------------------------ */
/* ChipTag — compact inline tag; the workflow/brand variants carry the  */
/* fixed sim brand tones so cards keep the sim canvas look.             */
/* ------------------------------------------------------------------ */

type ChipTagIcon = ComponentType<{ className?: string }>;

const WORKFLOW_TONE_CLASSES: Record<string, string> = {
  neutral: "bg-[#FFFFFF] text-[#1A1A1A] shadow-[inset_0_0_0_1px_#C3C3C3]",
  inverse: "bg-[#3B3B3B] text-[#F8F8F8]",
  ash: "bg-[#E6E6E6] text-[#1A1A1A]",
  orange: "bg-[#FF4C00] text-[#F8F8F8]",
  blue: "bg-[#0062FF] text-[#F8F8F8]",
  green: "bg-[#188F00] text-[#F8F8F8]",
  yellow: "bg-[#FFEF08] text-[#1A1A1A]",
  purple: "bg-[#AA00FF] text-[#F8F8F8]",
  identity: "bg-[#8B5CF6] text-[#F8F8F8]",
  content: "bg-[#007E80] text-[#FFFFFF]",
};

export interface ChipTagProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  children: ReactNode;
  variant?: "mono" | "field" | "gray" | "solid" | "workflow" | "brand" | "invite";
  tone?: keyof typeof WORKFLOW_TONE_CLASSES;
  brandColor?: CSSProperties["background"];
  brandForeground?: "light" | "dark";
  invalid?: boolean;
  leftIcon?: ChipTagIcon;
  rightIcon?: ChipTagIcon;
  onRightIconClick?: MouseEventHandler<HTMLButtonElement>;
  rightIconLabel?: string;
  rightIconDisabled?: boolean;
}

export function ChipTag({
  variant = "mono",
  tone = "neutral",
  brandColor,
  brandForeground = "light",
  invalid: _invalid,
  className,
  children,
  style,
  leftIcon: LeftIcon,
  rightIcon: RightIcon,
  onRightIconClick,
  rightIconLabel,
  rightIconDisabled,
  ...props
}: ChipTagProps) {
  const base = "inline-flex items-center rounded-md text-sm leading-5 transition-colors h-5 gap-[3px] px-1";
  const variantClass =
    variant === "workflow"
      ? WORKFLOW_TONE_CLASSES[tone] ?? WORKFLOW_TONE_CLASSES.neutral
      : variant === "brand"
        ? brandForeground === "dark"
          ? "text-[#000000]"
          : "text-[#FFFFFF]"
        : variant === "gray"
          ? "border border-[var(--border-1)] bg-[var(--surface-5)] text-[var(--text-secondary)]"
          : variant === "solid"
            ? "bg-[var(--text-secondary)] text-[var(--text-inverse)]"
            : "bg-[var(--surface-5)] text-[var(--text-primary)]";
  const iconClass = cn(
    "size-[14px] flex-shrink-0",
    variant !== "workflow" && variant !== "brand" && "text-[var(--text-icon)]",
  );
  const resolvedStyle = variant === "brand" ? { ...style, background: brandColor } : style;
  const interactive = RightIcon != null && onRightIconClick != null;

  return (
    <span className={cn(base, variantClass, className)} style={resolvedStyle} {...props}>
      {LeftIcon ? <LeftIcon className={iconClass} /> : null}
      {children}
      {RightIcon ? (
        interactive ? (
          <button
            type="button"
            onClick={onRightIconClick}
            disabled={rightIconDisabled}
            aria-label={rightIconLabel}
            className="relative flex flex-shrink-0 items-center opacity-80 transition-opacity focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RightIcon className={iconClass} />
          </button>
        ) : (
          <RightIcon className={iconClass} />
        )
      ) : null}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Badge — status color badge with an optional dot                      */
/* ------------------------------------------------------------------ */

const BADGE_VARIANT_CLASSES: Record<string, string> = {
  red: "bg-[#FDE8E8] text-[#C81E1E]",
  amber: "bg-[#FDF6B2] text-[#8E4B10]",
  orange: "bg-[#FEECDC] text-[#B43403]",
  green: "bg-[#DEF7EC] text-[#046C4E]",
  gray: "bg-[var(--surface-4)] text-[var(--text-secondary)]",
};

export interface BadgeProps extends HTMLAttributes<HTMLDivElement> {
  variant?: keyof typeof BADGE_VARIANT_CLASSES;
  dot?: boolean;
}

export function Badge({ variant = "gray", dot = false, className, children, ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-[9px] py-0.5 text-xs transition-colors focus:outline-none",
        BADGE_VARIANT_CLASSES[variant] ?? BADGE_VARIANT_CLASSES.gray,
        className,
      )}
      {...props}
    >
      {dot && <div className="size-1.5 rounded-[2px] bg-current" />}
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Switch — small toggle matching sim's canvas switch                   */
/* ------------------------------------------------------------------ */

export interface SwitchProps {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}

export function Switch({ checked, onCheckedChange, disabled, className, ...props }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={props["aria-label"]}
      disabled={disabled}
      onClick={() => onCheckedChange?.(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-none",
        checked ? "bg-[var(--text-primary)]" : "bg-[var(--border-1)]",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      <span
        className={cn(
          "pointer-events-none block size-4 rounded-full bg-[var(--surface-2)] shadow-sm transition-transform",
          checked ? "translate-x-[18px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}
