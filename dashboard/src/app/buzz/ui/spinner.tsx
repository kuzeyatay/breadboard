"use client";

import type * as React from "react";

import { cn } from "@/app/buzz/lib/cn";
import BreadboardLoader from "@/app/components/breadboard-loader";

type SpinnerProps = React.ComponentPropsWithoutRef<"span"> & {
  className?: string;
  size?: number | string;
};

export function Spinner({
  children,
  className,
  size,
  role = "status",
  "aria-label": ariaLabel = "Loading",
  "aria-hidden": ariaHidden,
  style,
  ...rest
}: SpinnerProps) {
  const isDecorative = ariaHidden === true || ariaHidden === "true";

  return (
    <span
      aria-hidden={ariaHidden}
      className={cn(
        "inline-flex h-6 w-6 shrink-0 items-center justify-center",
        className,
      )}
      role={isDecorative ? undefined : role}
      style={{
        ...(size === undefined ? null : { height: size, width: size }),
        ...style,
      }}
      {...rest}
    >
      <BreadboardLoader className="h-full w-full" />
      {children}
      {isDecorative ? null : <span className="sr-only">{ariaLabel}</span>}
    </span>
  );
}
