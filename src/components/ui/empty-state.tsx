import * as React from "react"
import { Inbox } from "lucide-react"

import { cn } from "@/lib/utils"

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: React.ReactNode
  title: string
  description?: string
}

function EmptyState({ icon, title, description, className, children, ...props }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border/70 bg-card p-10 text-center",
        className
      )}
      {...props}
    >
      {icon ?? <Inbox className="h-8 w-8 text-muted-foreground" />}
      <p className="text-sm text-muted-foreground">{title}</p>
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
      {children}
    </div>
  )
}

export { EmptyState }
