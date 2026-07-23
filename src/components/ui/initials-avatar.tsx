import * as React from "react"

import { cn } from "@/lib/utils"

const variantClasses = {
  solid: "bg-gradient-to-br from-primary to-accent text-primary-foreground",
  soft: "bg-gradient-to-br from-primary/15 to-accent/25 font-display text-primary",
  muted: "bg-muted text-muted-foreground",
} as const

export interface InitialsAvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  name: string
  photo?: string | null
  variant?: keyof typeof variantClasses
}

function InitialsAvatar({ name, photo, variant = "solid", className, children, ...props }: InitialsAvatarProps) {
  return (
    <div className={cn("relative h-9 w-9 shrink-0 overflow-hidden rounded-full", className)} {...props}>
      {photo ? (
        <img src={photo} alt={name} className="h-full w-full object-cover" />
      ) : (
        <div
          className={cn(
            "flex h-full w-full items-center justify-center text-sm font-semibold",
            variantClasses[variant]
          )}
        >
          {name.charAt(0)}
        </div>
      )}
      {children}
    </div>
  )
}

export { InitialsAvatar }
