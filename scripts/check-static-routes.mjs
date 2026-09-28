#!/usr/bin/env node
/**
 * Runs after `next build` (package.json "postbuild").
 *
 * Prerendered pages are served from the CDN under a hash-based CSP that the
 * middleware derives from the served HTML (lib/security/page-hashes.ts). That
 * only holds while the HTML is fixed for the life of the deployment and the
 * middleware knows which paths are prerendered, so this fails the build when:
 *   - a prerendered page revalidates after the build (ISR);
 *   - a dynamic segment would render unknown params on demand;
 *   - the prerendered routes differ from lib/security/static-routes.json.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export function prerenderedRoutes(nextDir) {
  const prerender = JSON.parse(readFileSync(join(nextDir, "prerender-manifest.json"), "utf8"));
  const srcRoutes = new Set();
  const revalidating = [];
  for (const [route, meta] of Object.entries(prerender.routes)) {
    const html = join(nextDir, "server", "app", `${route === "/" ? "index" : route}.html`);
    if (!existsSync(html)) continue; // sitemaps, icons and other non-page routes
    if (route.startsWith("/_")) continue; // _not-found and friends have no URL
    if (meta.initialRevalidateSeconds !== false) revalidating.push(route);
    srcRoutes.add(meta.srcRoute ?? route);
  }
  const onDemand = Object.entries(prerender.dynamicRoutes ?? {})
    .filter(([, meta]) => meta.fallback !== false)
    .map(([route]) => route);
  return { srcRoutes, revalidating, onDemand };
}

export function check(nextDir, declared) {
  const { srcRoutes, revalidating, onDemand } = prerenderedRoutes(nextDir);
  const problems = [];
  if (revalidating.length) {
    problems.push(
      `${revalidating.length} prerendered page(s) revalidate after the build, so their HTML would drift from its CSP hashes:\n  ` +
        revalidating.slice(0, 20).join("\n  ") +
        (revalidating.length > 20 ? `\n  … and ${revalidating.length - 20} more` : "") +
        `\nMake them dynamic (export const dynamic = "force-dynamic") or fully static.`
    );
  }
  if (onDemand.length) {
    problems.push(
      `${onDemand.length} route(s) would prerender unknown params on demand, which nobody hashes:\n  ` +
        onDemand.join("\n  ") +
        `\nSet dynamicParams = false when every param is listed, or make the route dynamic.`
    );
  }
  const missing = [...srcRoutes].filter((r) => !declared.has(r)).sort();
  const stale = [...declared].filter((r) => !srcRoutes.has(r)).sort();
  if (missing.length || stale.length) {
    problems.push(
      `lib/security/static-routes.json does not match the build.` +
        (missing.length ? `\nPrerendered but not listed (add them):\n  ${missing.join("\n  ")}` : "") +
        (stale.length ? `\nListed but no longer prerendered (remove them, or fix the page):\n  ${stale.join("\n  ")}` : "")
    );
  }
  return { problems, count: srcRoutes.size };
}

function main() {
  const nextDir = resolve(process.argv[2] ?? ".next");
  const declared = new Set(JSON.parse(readFileSync(join(here, "..", "lib", "security", "static-routes.json"), "utf8")));
  const { problems, count } = check(nextDir, declared);
  if (problems.length) {
    console.error(problems.join("\n\n"));
    process.exit(1);
  }
  console.log(`static routes: ${count} prerendered route(s) match lib/security/static-routes.json`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
