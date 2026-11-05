// ============ Helpers ============

export function formatApiName(name: string): string {
  return name
    .replace(/google_/g, "G:")
    .replace(/_/g, " ")
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
