import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
export { safeJsonStringify, cleanObject } from "./json-guard"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
