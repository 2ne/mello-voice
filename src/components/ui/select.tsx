"use client";

import { type ComponentProps } from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { ChevronDownIcon } from "@/components/icons/ChevronDownIcon";
import { CheckIcon } from "@/components/icons/CheckIcon";
import { cn } from "@/lib/utils";

/** Fixed width for trailing settings controls (selects, shortcut field). */
export const SETTINGS_CONTROL_WIDTH_CLASS = "w-[10rem]";

/** Shared shell for trailing settings controls. */
function settingsControlTriggerCn(className?: string) {
  return cn(
    SETTINGS_CONTROL_WIDTH_CLASS,
    "group inline-flex h-9 max-w-none shrink-0 items-center justify-between gap-2 rounded-xl border border-border bg-transparent px-3 text-left text-base outline-none transition-[background-color,color,box-shadow] duration-80 touch-manipulation",
    "disabled:pointer-events-none disabled:opacity-50",
    "hover:bg-foreground/[0.04] dark:hover:bg-foreground/[0.06]",
    className,
  );
}

const Select = SelectPrimitive.Root;

const SelectValue = SelectPrimitive.Value;

function SelectTrigger({ className, children, ref, ...props }: ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
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
      <ChevronDownIcon className="size-4 shrink-0 opacity-65 transition-opacity duration-80 group-disabled:opacity-40" strokeWidth={1.75} />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
  );
}

const SelectPortal = SelectPrimitive.Portal;

function SelectContent({
  className,
  children,
  sideOffset = 6,
  collisionPadding = 10,
  align = "end",
  side,
  matchTriggerWidth = true,
  variant = "popper",
  ref,
  ...props
}: ComponentProps<typeof SelectPrimitive.Content> & {
  matchTriggerWidth?: boolean;
  /** `menu` = opens upward, fixed width, no scroll chrome — for settings drawer controls near the bottom. */
  variant?: "popper" | "menu";
}) {
  const isMenu = variant === "menu";
  const resolvedSide = side ?? (isMenu ? "top" : "bottom");

  return (
  <SelectPortal>
    <SelectPrimitive.Content
      ref={ref}
      side={resolvedSide}
      sideOffset={sideOffset}
      align={align}
      collisionPadding={collisionPadding}
      position="popper"
      avoidCollisions
      style={
        isMenu
          ? {
              minWidth: "var(--radix-select-trigger-width)",
              width: "17rem",
            }
          : matchTriggerWidth
            ? { width: "var(--radix-select-trigger-width)" }
            : undefined
      }
      className={cn(
        "relative z-[150] rounded-xl bg-popover text-popover-foreground outline-none motion-reduce:transition-none",
        isMenu
          ? "overflow-hidden p-1"
          : "z-[200] mt-1 max-h-[min(340px,var(--radix-select-content-available-height))] p-1",
        !isMenu &&
          (matchTriggerWidth
            ? "min-w-[var(--radix-select-trigger-width)]"
            : "min-w-[var(--radix-select-trigger-width)] w-max max-w-[min(24rem,calc(100vw-2rem))]"),
        "shadow-none ring-1 ring-black/[0.045] dark:ring-white/[0.065]",
        className,
      )}
      {...props}
    >
      {isMenu ? (
        <SelectPrimitive.Viewport className="p-0">{children}</SelectPrimitive.Viewport>
      ) : (
        <>
          <SelectPrimitive.ScrollUpButton className="flex cursor-default justify-center py-1 text-muted-foreground data-[hidden]:hidden">
            <ChevronDownIcon className="-rotate-180 opacity-65" strokeWidth={1.75} />
          </SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport className={cn("p-0")}>{children}</SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className="flex cursor-default justify-center py-1 text-muted-foreground data-[hidden]:hidden">
            <ChevronDownIcon className="opacity-65" strokeWidth={1.75} />
          </SelectPrimitive.ScrollDownButton>
        </>
      )}
    </SelectPrimitive.Content>
  </SelectPortal>
  );
}

function SelectItem({ className, children, ref, ...props }: ComponentProps<typeof SelectPrimitive.Item>) {
  return (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex w-full select-none items-center gap-2 rounded-lg py-2 pl-2 pr-8 text-base outline-none transition-[background-color,color] duration-80 touch-manipulation",
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
  );
}

function SelectStackedItem({
  className,
  primaryLabel,
  secondaryLabel,
  ref,
  ...props
}: ComponentProps<typeof SelectPrimitive.Item> & {
  primaryLabel: string;
  secondaryLabel?: string;
}) {
  return (
    <SelectPrimitive.Item
      ref={ref}
      className={cn(
        "relative flex w-full select-none items-start gap-2 rounded-lg py-2.5 pl-2.5 pr-8 text-base outline-none transition-[background-color,color] duration-80 touch-manipulation",
        "text-muted-foreground data-[state=checked]:text-foreground",
        "data-[highlighted]:bg-muted data-[highlighted]:text-foreground",
        "data-[state=checked]:bg-muted/70 data-[state=checked]:data-[highlighted]:bg-muted",
        "disabled:pointer-events-none disabled:opacity-40",
        className,
      )}
      {...props}
    >
      <span className="min-w-0 flex-1 overflow-hidden pr-1">
        <SelectPrimitive.ItemText asChild>
          <span className="block truncate leading-snug">{primaryLabel}</span>
        </SelectPrimitive.ItemText>
        {secondaryLabel ? (
          <span className="mt-0.5 block text-sm leading-snug text-muted-foreground">{secondaryLabel}</span>
        ) : null}
      </span>
      <SelectPrimitive.ItemIndicator className="absolute right-1.5 top-2.5 inline-flex shrink-0 text-foreground">
        <CheckIcon strokeWidth={2} />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}

export { Select, SelectValue, SelectTrigger, SelectContent, SelectItem, SelectStackedItem, settingsControlTriggerCn };
