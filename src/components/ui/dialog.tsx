"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X, Minus } from "lucide-react"

import { cn } from "@/lib/utils"

const Dialog = DialogPrimitive.Root

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = DialogPrimitive.Portal

const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-slate-950/45 backdrop-blur-[3px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    onMinimize?: () => void;
    minimizeLabel?: string;
  }
>(({ className, children, onMinimize, minimizeLabel = "Minimizar", ...props }, ref) => {
  const minimizeHandled = React.useRef(false);

  const triggerMinimize = () => {
    if (!onMinimize || minimizeHandled.current) return;
    minimizeHandled.current = true;
    onMinimize();
    window.setTimeout(() => {
      minimizeHandled.current = false;
    }, 400);
  };

  return (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-[50%] top-[50%] z-50 grid w-[calc(100%-1rem)] max-w-lg max-h-[92dvh] translate-x-[-50%] translate-y-[-50%] gap-4 overflow-y-auto overscroll-contain rounded-2xl border border-border/70 bg-background p-4 shadow-[0_24px_70px_-24px_rgba(15,23,42,0.55)] duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-2xl sm:p-6",
        className
      )}
      {...props}
    >
      {children}
      <div className="absolute right-4 top-4 z-20 flex items-center gap-1">
        {onMinimize && (
          <button
            type="button"
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.stopPropagation();
              event.preventDefault();
              triggerMinimize();
            }}
            onClick={(event) => {
              event.stopPropagation();
              triggerMinimize();
            }}
            title={minimizeLabel}
            aria-label={minimizeLabel}
            className="flex h-11 w-11 items-center justify-center rounded-lg leading-none text-muted-foreground opacity-80 ring-offset-background transition-colors hover:bg-muted hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring/40 focus:ring-offset-2 sm:h-8 sm:w-8"
          >
            <Minus className="h-4 w-4" />
            <span className="sr-only">{minimizeLabel}</span>
          </button>
        )}
        <DialogPrimitive.Close
          aria-label="Cerrar"
          className="flex h-11 w-11 items-center justify-center rounded-lg leading-none text-muted-foreground opacity-80 ring-offset-background transition-colors hover:bg-muted hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring/40 focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground sm:h-8 sm:w-8"
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Cerrar</span>
        </DialogPrimitive.Close>
      </div>
    </DialogPrimitive.Content>
  </DialogPortal>
  );
});
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      // pr-24 en móvil: reserva sitio para los dos iconos (minimizar + cerrar)
      // y evita que la descripción quede debajo de ellos.
      "flex flex-col space-y-1.5 pr-24 text-center sm:pr-0 sm:text-left",
      className
    )}
    {...props}
  />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className
    )}
    {...props}
  />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight",
      className
    )}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
