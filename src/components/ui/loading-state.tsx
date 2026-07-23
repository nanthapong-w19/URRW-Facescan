import * as React from "react"
import { Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"

export interface LoadingStateProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string
}

function LoadingState({ label, className, ...props }: LoadingStateProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-center gap-2 rounded-2xl border border-border/70 bg-card p-10 text-sm text-muted-foreground",
        className
      )}
      {...props}
    >
      <Loader2 className="h-4 w-4 animate-spin" /> {label}
    </div>
  )
}

export { LoadingState }
