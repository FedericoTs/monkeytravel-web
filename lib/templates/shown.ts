/**
 * Whether trip templates show: the home page's Curated escapes, the rows on
 * My trips, the planner's "browse templates" link and the template pages
 * themselves, which otherwise send visitors on (to the trip's public page, or
 * to the planner). Off unless NEXT_PUBLIC_TEMPLATES_ENABLED is "true".
 */
export function templatesShown(): boolean {
  return process.env.NEXT_PUBLIC_TEMPLATES_ENABLED === "true";
}
