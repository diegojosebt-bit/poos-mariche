import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Tokens de `autoComplete` permitidos solo en campos de acceso/credenciales
 * (login, registro y contraseñas). En el resto de la app se desactiva el
 * autocompletado del navegador y los gestores de contraseñas.
 */
const ACCESS_AUTOCOMPLETE_TOKENS = new Set([
  "email",
  "username",
  "current-password",
  "new-password",
  "one-time-code",
  "name",
  "organization",
  "tel",
])

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, autoComplete, ...props }, ref) => {
    const isAccessInput =
      type === "password" ||
      type === "email" ||
      (typeof autoComplete === "string" && ACCESS_AUTOCOMPLETE_TOKENS.has(autoComplete))

    // Chrome/Edge suelen ignorar `autoComplete="off"`; un token no estándar
    // junto con los atributos `data-*` suprime sugerencias del navegador y gestores.
    const resolvedAutoComplete = isAccessInput ? autoComplete : "chrome-off"
    const suppressAutofillAttrs = isAccessInput
      ? {}
      : {
          "data-lpignore": "true",
          "data-1p-ignore": "true",
          "data-bwignore": "true",
          "data-form-type": "other",
        }

    return (
      <input
        type={type}
        autoComplete={resolvedAutoComplete}
        className={cn(
          "flex h-10 w-full rounded-lg border border-border/80 bg-muted/60 px-3 py-2 text-base shadow-[inset_0_1px_2px_rgba(15,23,42,0.04)] ring-offset-background transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground/70 focus-visible:border-ring/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className
        )}
        ref={ref}
        {...suppressAutofillAttrs}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
