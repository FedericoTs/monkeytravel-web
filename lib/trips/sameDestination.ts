/**
 * Does a new generation target the same place as the one already saved?
 *
 * Used by the wizard to decide whether re-generating should UPDATE the trip
 * that auto-save already persisted, or insert a new one.
 *
 * Same destination  -> update. The user changed the length, the dates or the
 *                      vibes and expects one trip, not two.
 * Different place   -> insert. Going back and planning another city is a
 *                      different trip; updating would silently overwrite the
 *                      one already saved.
 *
 * The two sides are shaped differently on purpose:
 *   - `savedName` comes from the generated itinerary (`destination.name`),
 *     which is the bare city: "Dubrovnik".
 *   - `formDestination` comes from the form field, which carries the country
 *     the autocomplete appended: "Dubrovnik, Croatia".
 * so the comparison takes the form value's first segment.
 */
export function isSameDestination(
  savedName: string | null | undefined,
  formDestination: string | null | undefined,
): boolean {
  const norm = (s: string | null | undefined) =>
    (s ?? "")
      .split(",")[0]
      .trim()
      .toLowerCase()
      // Accents and punctuation differ between what the model returns and what
      // the autocomplete stored ("Malaga" vs "Málaga", "St. Ives" vs "St Ives").
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[.'’]/g, "")
      .replace(/\s+/g, " ");

  const a = norm(savedName);
  const b = norm(formDestination);
  // Empty on either side means we cannot establish sameness — treat as
  // different, which is the safe direction: it inserts rather than overwrites.
  if (!a || !b) return false;
  return a === b;
}
