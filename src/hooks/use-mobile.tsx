import * as React from "react"

export const MOBILE_BREAKPOINT = 768
export const TABLET_MIN_WIDTH = 768
export const TABLET_MAX_WIDTH = 1180

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(mql.matches)
    }
    
    // Set the initial value
    onChange();
    
    mql.addEventListener("change", onChange)

    return () => mql.removeEventListener("change", onChange)
  }, [])

  return isMobile
}

/**
 * Hook para detectar tablets (768px - 1180px).
 * Cubre iPad vertical (768px), iPad horizontal estándar (1024px) y tablets de 11".
 */
export function useIsTablet() {
  const [isTablet, setIsTablet] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${TABLET_MIN_WIDTH}px) and (max-width: ${TABLET_MAX_WIDTH}px)`)
    const onChange = () => {
      setIsTablet(mql.matches)
    }

    onChange();
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return isTablet
}

export function useIsDesktop() {
  const [isDesktop, setIsDesktop] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${TABLET_MAX_WIDTH + 1}px)`)
    const onChange = () => {
      setIsDesktop(mql.matches)
    }

    onChange();
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return isDesktop
}

