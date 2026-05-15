"use client";

import { type ComponentProps } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "@/lib/utils";

const Popover = ({ modal = false, ...props }: ComponentProps<typeof PopoverPrimitive.Root>) => (
  <PopoverPrimitive.Root modal={modal} {...props} />
);

const PopoverTrigger = PopoverPrimitive.Trigger;

function PopoverContent({
  className,
  align = "end",
  sideOffset = 6,
  collisionPadding = 10,
  ref,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      collisionPadding={collisionPadding}
      className={cn(
        "z-[200] rounded-xl bg-popover p-1 text-popover-foreground outline-none motion-reduce:transition-none",
        "shadow-none ring-1 ring-black/[0.045] dark:ring-white/[0.065]",
        className,
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverTrigger, PopoverContent };
