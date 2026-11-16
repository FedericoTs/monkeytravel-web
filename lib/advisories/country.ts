/**
 * The country part of a trip's destination, which is what the UK's travel
 * advice is published for: "Bangkok, Thailand" is Thailand, "Cancun, Quintana
 * Roo, Mexico" is Mexico, and a destination without a comma is taken whole.
 */
export function advisoryCountry(destination: string): string {
  const parts = destination
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts[parts.length - 1] ?? "";
}
