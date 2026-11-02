import type { TripMeta } from "@/types";

/**
 * The packing list a trip shows: its stored list when that has items, else
 * the suggestions its plan came with. An empty stored list is truthy, so a
 * bare `||` would never reach the suggestions.
 */
export function tripPackingList(column: unknown, meta: TripMeta): string[] {
  if (Array.isArray(column) && column.length > 0) return column as string[];
  return (meta.packing_suggestions as string[] | undefined) || [];
}
