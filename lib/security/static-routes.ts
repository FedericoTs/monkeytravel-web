import { routing } from "@/lib/i18n/routing";
import staticRoutes from "./static-routes.json";

/**
 * The routes `next build` prerenders, in Next's route syntax. Middleware uses
 * them to know which paths are served from the CDN (and so get the
 * hash-based CSP); scripts/check-static-routes.mjs fails the build when the
 * list and the build disagree.
 */
export const STATIC_ROUTES: readonly string[] = staticRoutes;

const nonDefaultLocales = routing.locales.filter((l) => l !== routing.defaultLocale);
const localePrefix = `(?:/(?:${nonDefaultLocales.join("|")}))?`;

function toPattern(route: string): RegExp {
  const rest = route.replace(/^\/\[locale\]/, "");
  if (rest === "") return new RegExp(`^${localePrefix}/?$`);
  const body = rest
    .split("/")
    .map((seg) => (/^\[.+\]$/.test(seg) ? "[^/]+" : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("/");
  return new RegExp(`^${localePrefix}${body}$`);
}

const PATTERNS = STATIC_ROUTES.map(toPattern);

/** Whether a request path belongs to a prerendered route (the page itself may still 404). */
export function isStaticPagePath(pathname: string): boolean {
  return PATTERNS.some((p) => p.test(pathname));
}
