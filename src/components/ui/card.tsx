import * as React from "react"

import { cn } from "@/lib/utils"
import { Elevated } from "@/lib/elevated"

function Card({
  className,
  size = "default",
  /** Default +1 substrate step — see https://www.fluidfunctionalism.com/docs/surfaces */
  surfaceOffset = 1,
  ...props
}: React.ComponentProps<"div"> & { size?: "default" | "sm"; surfaceOffset?: number }) {
  return (
    <Elevated
      offset={surfaceOffset}
      data-slot="card"
      data-size={size}
      className={cn(
        "group/card flex flex-col gap-6 overflow-hidden rounded-4xl py-6 text-sm text-foreground outline-none has-[>img:first-child]:pt-0 data-[size=sm]:gap-4 data-[size=sm]:py-0 *:[img:first-child]:rounded-t-4xl *:[img:last-child]:rounded-b-4xl",
        className,
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-6 group-data-[size=sm]/card:px-4", className)}
      {...props}
    />
  )
}

export {
  Card,
  CardContent,
}
