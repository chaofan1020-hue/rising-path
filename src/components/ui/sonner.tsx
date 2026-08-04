"use client"

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
          "--success-bg": "oklch(0.21 0.006 285.885)",
          "--success-text": "oklch(0.985 0 0)",
          "--info-bg": "oklch(0.21 0.006 285.885)",
          "--info-text": "oklch(0.985 0 0)",
          "--warning-bg": "oklch(0.21 0.006 285.885)",
          "--warning-text": "oklch(0.985 0 0)",
          "--error-bg": "oklch(0.21 0.006 285.885)",
          "--error-text": "oklch(0.985 0 0)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
