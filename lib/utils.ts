import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Tailwind CSS class merge utility
 * Combines clsx and tailwind-merge for optimal class handling
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Date/time utilities have moved to @/lib/datetime
// Import from there: import { formatDateRange, formatDateWithWeekday } from "@/lib/datetime"
