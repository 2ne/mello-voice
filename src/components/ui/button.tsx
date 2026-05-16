"use client";

import {
  type ButtonHTMLAttributes,
  type ComponentType,
  type Ref,
} from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { useShape } from "@/lib/shape-context";

/** Leading/trailing slot shape for lightweight SVG icon components. */
type IconComponent = ComponentType<{
  size?: number;
  strokeWidth?: number;
  className?: string;
}>;

const buttonVariants = cva(
  [
    "group relative isolate inline-flex items-center justify-center outline-none",
    "text-box-trim-both text-box-edge-cap-alphabetic",
    "touch-manipulation transition-transform duration-80 ease-[var(--ease-ui)]",
    "active:scale-[0.975]",
    "disabled:opacity-50 disabled:pointer-events-none",
    "focus-visible:ring-1 focus-visible:ring-primary",
  ],
  {
    variants: {
      variant: {
        primary: "text-background",
        secondary: "text-foreground",
        tertiary: "border border-border text-foreground",
        surface:
          "border-0 text-foreground shadow-surface-2 ring-1 ring-black/[0.045] dark:shadow-none dark:ring-white/[0.065]",
        overlay:
          "border border-[color:var(--overlay-inline-border)] text-overlay-chrome-fg",
        ghost: "text-muted-foreground hover:text-foreground",
      },
      size: {
        sm: "h-7 px-3 text-[12px] gap-1",
        md: "h-8 px-4 text-[13px] gap-1.5",
        lg: "h-9 px-5 text-[14px] gap-1.5",
        "icon-sm": "h-8 w-8 p-0 [&_svg]:h-3.5 [&_svg]:w-3.5",
        icon: "h-9 w-9 p-0 [&_svg]:h-4 [&_svg]:w-4",
        "icon-lg": "h-10 w-10 p-0 [&_svg]:h-5 [&_svg]:w-5",
      },
      iconLeft: { true: "" },
      iconRight: { true: "" },
    },
    compoundVariants: [
      { size: "sm", iconLeft: true, className: "pl-[6px]" },
      { size: "md", iconLeft: true, className: "pl-[10px]" },
      { size: "lg", iconLeft: true, className: "pl-[14px]" },
      { size: "sm", iconRight: true, className: "pr-[6px]" },
      { size: "md", iconRight: true, className: "pr-[10px]" },
      { size: "lg", iconRight: true, className: "pr-[14px]" },
    ],
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  }
);

interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
  leadingIcon?: IconComponent;
  trailingIcon?: IconComponent;
  ref?: Ref<HTMLButtonElement>;
}

const bgVariants: Record<string, string> = {
  primary: "bg-foreground group-hover:bg-foreground/90 group-active:bg-foreground/80",
  secondary: "bg-accent group-hover:bg-accent/80 group-active:bg-accent",
  tertiary: "bg-transparent group-hover:bg-hover group-active:bg-active",
  /** Matches Card (+1): `bg-card`, same soft ring + Fluid shadow as every `Elevated` surface. */
  surface:
    "bg-card group-hover:bg-surface-3 group-active:bg-surface-3 dark:group-hover:bg-surface-3 dark:group-active:bg-surface-3",
  overlay:
    "bg-[color:var(--overlay-inline-bg)] group-hover:bg-[color:var(--overlay-inline-bg-hover)] group-active:bg-[color:var(--overlay-inline-bg)]",
  ghost: "bg-transparent group-hover:bg-hover group-active:bg-active",
};

function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  leadingIcon: LeadingIcon,
  trailingIcon: TrailingIcon,
  disabled,
  children,
  style,
  ref,
  ...props
}: ButtonProps) {
    const Comp = asChild ? Slot : "button";
    const isIconOnly = size === "icon" || size === "icon-sm" || size === "icon-lg";
    const iconSize = size === "sm" ? 14 : size === "lg" ? 20 : 16;
    const shape = useShape();
    const bgClass = bgVariants[variant ?? "primary"];

    return (
      <Comp
        ref={ref}
        className={cn(
          buttonVariants({
            variant,
            size,
            iconLeft: !isIconOnly && !!LeadingIcon,
            iconRight: !isIconOnly && !!TrailingIcon,
          }),
          shape.button,
          className
        )}
        disabled={disabled || loading}
        style={style}
        {...props}
      >
        <span
          aria-hidden
          className={cn(
            "absolute inset-0 rounded-[inherit] transition-[background-color] duration-80 ease-[var(--ease-ui)]",
            bgClass
          )}
        />
        <span className="relative inline-flex items-center justify-center gap-[inherit]">
          {loading ? (
            <>
              <span className="flex items-center justify-center gap-[inherit] opacity-0">
                {LeadingIcon && !isIconOnly && (
                  <LeadingIcon size={iconSize} strokeWidth={2} />
                )}
                {children}
                {TrailingIcon && !isIconOnly && (
                  <TrailingIcon size={iconSize} strokeWidth={2} />
                )}
              </span>
              <span className="absolute inset-0 flex items-center justify-center">
                <svg
                  className="size-8"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <path
                    d="M 12 12 C 14 8.5 19 8.5 19 12 C 19 15.5 14 15.5 12 12 C 10 8.5 5 8.5 5 12 C 5 15.5 10 15.5 12 12 Z"
                    stroke="currentColor"
                    strokeWidth="1.125"
                    strokeLinecap="round"
                    pathLength="100"
                    style={{
                      strokeDasharray: "15 85",
                      animation:
                        "spinner-move 900ms linear infinite, spinner-dash 900ms var(--ease-spinner-dash) infinite",
                    }}
                  />
                </svg>
              </span>
            </>
          ) : isIconOnly ? (
            <span className="[&_svg]:stroke-[1.5] [&_svg]:transition-[stroke-width] [&_svg]:duration-80 [&_svg]:ease-[var(--ease-ui)] group-hover:[&_svg]:stroke-[2]">
              {children}
            </span>
          ) : (
            <>
              {LeadingIcon && (
                <LeadingIcon
                  size={iconSize}
                  strokeWidth={1.5}
                  className="transition-[stroke-width] duration-80 ease-[var(--ease-ui)] group-hover:stroke-[2]"
                />
              )}
              <span>{children}</span>
              {TrailingIcon && (
                <TrailingIcon
                  size={iconSize}
                  strokeWidth={1.5}
                  className="transition-[stroke-width] duration-80 ease-[var(--ease-ui)] group-hover:stroke-[2]"
                />
              )}
            </>
          )}
        </span>
      </Comp>
    );
}

export { Button };
