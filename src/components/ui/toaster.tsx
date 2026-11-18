"use client"

import { AlertTriangle, CheckCircle2, OctagonAlert } from "lucide-react"

import { useToast } from "@/hooks/use-toast"
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast"
import { cn } from "@/lib/utils"

/** Icono y tono por tipo de aviso: verde confirmación, ámbar precaución, rojo cuidado. */
const VARIANT_STYLE = {
  success: { Icon: CheckCircle2, badge: "bg-white/20" },
  warning: { Icon: AlertTriangle, badge: "bg-amber-900/15" },
  destructive: { Icon: OctagonAlert, badge: "bg-white/20" },
} as const

export function Toaster() {
  const { toasts } = useToast()

  return (
    <ToastProvider duration={1000}>
      {toasts.map(function ({ id, title, description, action, variant, ...props }) {
        const key = (variant === "warning" || variant === "destructive" ? variant : "success") as keyof typeof VARIANT_STYLE
        const { Icon, badge } = VARIANT_STYLE[key]

        return (
          <Toast key={id} variant={variant} {...props}>
            <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", badge)}>
              <Icon className="h-4 w-4" strokeWidth={2.5} />
            </span>

            <div className="grid min-w-0 gap-0.5">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && <ToastDescription>{description}</ToastDescription>}
            </div>
            {action}
            <ToastClose />
          </Toast>
        )
      })}
      <ToastViewport />
    </ToastProvider>
  )
}
