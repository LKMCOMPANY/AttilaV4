import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function countryCodeToFlag(code: string): string {
  if (!code || code.length !== 2) return "";
  return String.fromCodePoint(
    ...([...code.toUpperCase()].map((c) => 0x1f1e6 - 65 + c.charCodeAt(0)))
  );
}
