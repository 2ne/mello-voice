"use client";

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { type ReactElement, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface TooltipProps {
  content: ReactNode;
  /** Must be a single element that forwards refs (e.g. button, time). */
  children: ReactElement;
  side?: "top" | "right" | "bottom" | "left";
  sideOffset?: number;
  delayDuration?: number;
  /** Merged onto the animated tooltip surface (popover shell). */
  className?: string;
  /** When set, controls visibility instead of hover/focus. */
  forceOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const tooltipSurface = cn(
  "pointer-events-none z-[200] max-w-[min(90vw,20rem)] rounded-lg bg-popover px-2.5 py-1.5 text-xs font-medium leading-snug text-popover-foreground shadow-surface-2 ring-1 ring-black/[0.045] dark:shadow-none dark:ring-white/[0.065]",
  "origin-[var(--radix-tooltip-content-transform-origin)] opacity-0 scale-[0.96]",
  "transition-[opacity,transform] duration-160 ease-[var(--ease-ui)]",
  "data-[state=delayed-open]:opacity-100 data-[state=delayed-open]:scale-100",
  "data-[state=instant-open]:opacity-100 data-[state=instant-open]:scale-100",
  "starting:data-[state=delayed-open]:opacity-0 starting:data-[state=delayed-open]:scale-[0.96]",
  "starting:data-[state=instant-open]:opacity-0 starting:data-[state=instant-open]:scale-[0.96]",
  "motion-reduce:transition-none motion-reduce:duration-0",
  "motion-reduce:data-[state=delayed-open]:opacity-100 motion-reduce:data-[state=instant-open]:opacity-100 motion-reduce:scale-100",
);

export function TooltipProvider({
  children,
  delayDuration = 200,
  skipDelayDuration = 300,
}: {
  children: ReactNode;
  delayDuration?: number;
  skipDelayDuration?: number;
}) {
  return (
    <TooltipPrimitive.Provider delayDuration={delayDuration} skipDelayDuration={skipDelayDuration}>
      {children}
    </TooltipPrimitive.Provider>
  );
}

export function Tooltip({
  content,
  children,
  side = "top",
  sideOffset = 8,
  delayDuration = 200,
  className,
  forceOpen,
  onOpenChange,
}: TooltipProps) {
  const controlled = forceOpen !== undefined;

  return (
    <TooltipPrimitive.Root
      delayDuration={delayDuration}
      {...(controlled ? { open: forceOpen, onOpenChange } : { onOpenChange })}
    >
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        {/* No `asChild` here: Radix Tooltip content composes Slottable + VisuallyHidden
            siblings internally; Slot would call Children.only and throw. */}
        <TooltipPrimitive.Content
          side={side}
          sideOffset={sideOffset}
          className={cn(tooltipSurface, className)}
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
