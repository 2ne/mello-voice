"use client";

import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { ChevronDownIcon } from "@/components/icons/ChevronDownIcon";
import { CheckIcon } from "@/components/icons/CheckIcon";
import { cn } from "@/lib/utils";

/** Shared shell for trailing settings controls (select triggers and popovers). */
export function settingsControlTriggerCn(className?: string) {
  return cn(
    "group inline-flex h-9 min-w-[9.5rem] max-w-[12rem] flex-1 shrink-0 items-center justify-between gap-2 rounded-xl border border-border bg-transparent px-3 text-left text-[13px] outline-none cursor-pointer transition-[background-color,color,box-shadow] duration-80 ease-[var(--ease-ui)] touch-manipulation",
    "disabled:pointer-events-none disabled:opacity-50",
    "hover:bg-foreground/[0.04] dark:hover:bg-foreground/[0.06]",
    "focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-transparent dark:focus-visible:ring-offset-transparent",
    className,
  );
}

const Select = SelectPrimitive.Root;

const SelectGroup = SelectPrimitive.Group;

const SelectValue = SelectPrimitive.Value;

const SelectTrigger = forwardRef<
  ElementRef<typeof SelectPrimitive.Trigger>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      settingsControlTriggerCn(className),
      "data-placeholder:text-muted-foreground [&>span]:block [&>span]:min-w-0 [&>span]:truncate",
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDownIcon className="size-4 shrink-0 opacity-65 transition-opacity duration-80 ease-[var(--ease-ui)] group-disabled:opacity-40" strokeWidth={1.75} />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = "SelectTrigger";

const SelectPortal = SelectPrimitive.Portal;

const SelectContent = forwardRef<
  ElementRef<typeof SelectPrimitive.Content>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, sideOffset = 6, collisionPadding = 10, align = "end", ...props }, ref) => (
  <SelectPortal>
    <SelectPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      align={align}
      collisionPadding={collisionPadding}
      position="popper"
      avoidCollisions
      style={{ width: "var(--radix-select-trigger-width)" }}
      className={cn(
        "relative z-[200] mt-1 max-h-[min(340px,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] rounded-xl bg-popover p-1 text-popover-foreground outline-none motion-reduce:transition-none",
        /* Ring + fill only (no box-shadow, no hard border) — matches Elevated dark rule and avoids double chrome in light */
        "shadow-none ring-1 ring-black/[0.045] dark:ring-white/[0.065]",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ScrollUpButton className="flex cursor-default justify-center py-1 text-muted-foreground data-[hidden]:hidden">
        <ChevronDownIcon className="-rotate-180 opacity-65" strokeWidth={1.75} />
      </SelectPrimitive.ScrollUpButton>
      <SelectPrimitive.Viewport className={cn("p-0")}>{children}</SelectPrimitive.Viewport>
      <SelectPrimitive.ScrollDownButton className="flex cursor-default justify-center py-1 text-muted-foreground data-[hidden]:hidden">
        <ChevronDownIcon className="opacity-65" strokeWidth={1.75} />
      </SelectPrimitive.ScrollDownButton>
    </SelectPrimitive.Content>
  </SelectPortal>
));
SelectContent.displayName = "SelectContent";

const SelectLabel = forwardRef<
  ElementRef<typeof SelectPrimitive.Label>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn("px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground", className)}
    {...props}
  />
));
SelectLabel.displayName = "SelectLabel";

const SelectItem = forwardRef<
  ElementRef<typeof SelectPrimitive.Item>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex w-full cursor-pointer select-none items-center gap-2 rounded-lg py-2 pl-2 pr-8 text-[13px] outline-none transition-[background-color,color] duration-80 ease-[var(--ease-ui)] touch-manipulation",
      "text-muted-foreground data-[state=checked]:text-foreground",
      "data-[highlighted]:bg-muted data-[highlighted]:text-foreground",
      "data-[state=checked]:bg-muted/70 data-[state=checked]:data-[highlighted]:bg-muted",
      "disabled:pointer-events-none disabled:opacity-40",
      className,
    )}
    {...props}
  >
    <span className="min-w-0 flex-1 truncate">
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </span>
    <SelectPrimitive.ItemIndicator className="absolute right-1.5 inline-flex shrink-0 text-foreground">
      <CheckIcon strokeWidth={2} />
    </SelectPrimitive.ItemIndicator>
  </SelectPrimitive.Item>
));
SelectItem.displayName = "SelectItem";

const SelectSeparator = forwardRef<
  ElementRef<typeof SelectPrimitive.Separator>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator ref={ref} className={cn("-mx-1 my-1 h-px shrink-0 bg-border/80", className)} {...props} />
));
SelectSeparator.displayName = "SelectSeparator";

export { Select, SelectGroup, SelectValue, SelectTrigger, SelectPortal, SelectContent, SelectLabel, SelectItem, SelectSeparator };
