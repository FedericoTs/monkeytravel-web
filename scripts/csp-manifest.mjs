#!/usr/bin/env node
/**
 * Runs after `next build` (package.json "postbuild").
 *
 * Prerendered pages are served from the CDN, so their inline scripts cannot
 * carry a per-request nonce. This reads every prerendered HTML file, pins each
 * inline script by SHA-256 and embeds the result in the compiled middleware,
 * which serves the hash-based CSP for those paths (lib/security/csp-manifest.ts).
 *
 * A page that revalidates after the build would be served with hashes that no
 * longer match its HTML, so such pages fail the build here: make them dynamic
 * (`export const dynamic = "force-dynamic"`) or fully static.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SENTINEL = /["']__MT_CSP_MANIFEST__["']/g;
// Mirrors defaultLocale in lib/i18n/routing.ts (`localePrefix: "as-needed"`).
const DEFAULT_LOCALE = "en";
const JS_TYPES = new Set(["", "text/javascript", "application/javascript", "module"]);

/** `sha256-…` of every inline script that the browser would execute. */
export function inlineScriptHashes(html) {
  const hashes = new Set();
  const script = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = script.exec(html))) {
    const [, attrs, body] = match;
    if (/\ssrc\s*=/i.test(attrs) || !body) continue;
    const type = (attrs.match(/\stype\s*=\s*["']?([^"'\s>]*)/i)?.[1] ?? "").toLowerCase();
    if (!JS_TYPES.has(type)) continue; // JSON-LD and other data blocks never execute
    hashes.add(`sha256-${createHash("sha256").update(body, "utf8").digest("base64")}`);
  }
  return [...hashes].sort();
}

/** The URL a prerendered route answers on: the default locale carries no prefix. */
export function urlPathFor(route) {
  if (route === `/${DEFAULT_LOCALE}`) return "/";
  if (route.startsWith(`/${DEFAULT_LOCALE}/`)) return route.slice(DEFAULT_LOCALE.length + 1);
  return route;
}

export function buildManifest(nextDir) {
  const prerender = JSON.parse(readFileSync(join(nextDir, "prerender-manifest.json"), "utf8"));
  const pages = {};
  const revalidating = [];
  for (const [route, meta] of Object.entries(prerender.routes)) {
    const html = join(nextDir, "server", "app", `${route === "/" ? "index" : route}.html`);
    if (!existsSync(html)) continue; // sitemaps, icons and other non-page routes
    if (route.startsWith("/_")) continue; // _not-found and friends have no URL
    if (meta.initialRevalidateSeconds !== false) {
      revalidating.push(route);
      continue;
    }
    // Digests concatenated without the "sha256-" prefix: 44 chars each, and
    // the middleware splits them back (lib/security/csp-manifest.ts).
    pages[urlPathFor(route)] = inlineScriptHashes(readFileSync(html, "utf8"))
      .map((h) => h.slice("sha256-".length))
      .join("");
  }
  if (revalidating.length) {
    throw new Error(
      `${revalidating.length} prerendered page(s) revalidate after the build, so their inline-script hashes would go stale:\n  ` +
        revalidating.join("\n  ") +
        `\nMake them dynamic (export const dynamic = "force-dynamic") or fully static.`
    );
  }
  // A dynamic segment that still accepts unknown params would be generated on
  // demand and then served as static HTML nobody hashed.
  const onDemand = Object.entries(prerender.dynamicRoutes ?? {})
    .filter(([, meta]) => meta.fallback !== false)
    .map(([route]) => route);
  if (onDemand.length) {
    throw new Error(
      `${onDemand.length} route(s) would prerender unknown params on demand, without CSP hashes:\n  ` +
        onDemand.join("\n  ") +
        `\nSet dynamicParams = false when every param is listed, or make the route dynamic.`
    );
  }
  return { v: 2, pages };
}

/** Replaces the sentinel in every compiled middleware file; returns the replacement count. */
export function embed(nextDir, manifest) {
  const mwManifest = JSON.parse(readFileSync(join(nextDir, "server", "middleware-manifest.json"), "utf8"));
  const entry = Object.values(mwManifest.middleware ?? {})[0];
  if (!entry) throw new Error("no middleware in middleware-manifest.json");
  const literal = JSON.stringify(JSON.stringify(manifest));
  let replaced = 0;
  let alreadyEmbedded = false;
  for (const file of entry.files) {
    const path = join(nextDir, file);
    const source = readFileSync(path, "utf8");
    const count = (source.match(SENTINEL) ?? []).length;
    if (count === 0) {
      if (source.includes('\\"v\\":2,\\"pages\\":')) alreadyEmbedded = true;
      continue;
    }
    writeFileSync(path, source.replace(SENTINEL, () => literal));
    replaced += count;
  }
  if (replaced === 0 && !alreadyEmbedded) {
    throw new Error("the CSP manifest sentinel was not found in the compiled middleware");
  }
  return replaced;
}

function main() {
  const nextDir = resolve(process.argv[2] ?? ".next");
  const manifest = buildManifest(nextDir);
  writeFileSync(join(nextDir, "csp-manifest.json"), JSON.stringify(manifest));
  const replaced = embed(nextDir, manifest);
  const pageCount = Object.keys(manifest.pages).length;
  const hashCount = new Set(Object.values(manifest.pages).flatMap((s) => s.match(/.{44}/g) ?? [])).size;
  const bytes = JSON.stringify(manifest).length;
  console.log(
    `csp-manifest: ${pageCount} prerendered pages, ${hashCount} distinct inline-script hashes, ` +
      `${(bytes / 1024).toFixed(0)} KB embedded (${replaced} site${replaced === 1 ? "" : "s"})`
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
