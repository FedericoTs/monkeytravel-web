import type { BlogFrontmatter } from "./types";

/** The "best destinations" tag, as each language's posts write it. */
const CHOOSING_TAGS = new Set(["best destinations", "mejores destinos", "migliori destinazioni", "melhores destinos"]);

/**
 * Whether a post's reader is still choosing where to go: a seasonal piece or a
 * "best places" list that isn't about one place. They're offered "Where should
 * I go?" rather than the planner, which starts by asking for a destination.
 */
export function readerIsChoosing(post: Pick<BlogFrontmatter, "category" | "tags">, aboutOnePlace: boolean): boolean {
  if (aboutOnePlace) return false;
  return post.category === "Seasonal Travel" || (post.tags ?? []).some((tag) => CHOOSING_TAGS.has(tag.toLowerCase().trim()));
}
