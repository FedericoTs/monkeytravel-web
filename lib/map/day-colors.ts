/** Marker colours by day. The map and the trip card share them. */
export const DAY_COLORS = [
  "#FF6B6B", // coral
  "#00B4A6", // teal
  "#FFD93D", // gold
  "#A29BFE", // purple
  "#00B894", // green
  "#FD79A8", // pink
  "#74B9FF", // blue
  "#FDCB6E", // yellow
];

export function dayColor(dayNumber: number): string {
  const n = Number.isFinite(dayNumber) ? Math.max(1, Math.round(dayNumber)) : 1;
  return DAY_COLORS[(n - 1) % DAY_COLORS.length];
}
