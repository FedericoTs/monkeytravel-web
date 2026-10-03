/** About as long as a meta description Google shows without cutting it. */
export const META_DESCRIPTION_MAX = 155;

/**
 * Fits user-written text into a meta description: whitespace collapsed and,
 * when longer than `max`, cut at a word boundary with an ellipsis, so the
 * snippet never ends mid-word.
 */
export function clipMetaDescription(text: string, max = META_DESCRIPTION_MAX): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  const words = space > max * 0.6 ? cut.slice(0, space) : cut;
  return `${words.replace(/[\s,;:.!?–—-]+$/, "")}…`;
}
