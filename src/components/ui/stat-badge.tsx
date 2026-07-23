import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const statBadgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-0.5 text-xs font-medium",
  {
    variants: {
      variant: {
        default: "border-transparent bg-muted text-muted-foreground",
        primary: "border-transparent bg-primary/10 text-primary",
        success: "border-transparent bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
        warning: "border-transparent bg-amber-500/10 text-amber-800 dark:text-amber-400",
        destructive: "border-transparent bg-destructive/10 text-destructive",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface StatBadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof statBadgeVariants> {
  label: string
  count: number | string
}

function StatBadge({ className, variant, label, count, ...props }: StatBadgeProps) {
  return (
    <div className={cn(statBadgeVariants({ variant }), className)} {...props}>
      <span>{label}</span>
      <span className="font-semibold tabular-nums">{count}</span>
    </div>
  )
}

export { StatBadge, statBadgeVariants }
