/**
 * Destination cover images — the single source of truth is
 * lib/destinations/data.ts. Slugs are DERIVED from it, never hardcoded here,
 * so the image set can't silently drift out of sync with the destinations.
 *
 * MODES
 *   --check     Assert every destination in data.ts has a cover at
 *               public/images/destinations/<slug>.jpg. Exits 1 (and names the
 *               gaps + the fix) if any are missing. Pure filesystem — no
 *               network, no sharp — so it is safe + fast as a `prebuild` guard
 *               on Vercel. A coverless destination therefore CANNOT ship.
 *   --list      Print the slugs parsed from data.ts (debug).
 *   (default)   Backfill: fetch a real photo (Pexels) for every slug with no
 *               cover yet, crop to 1200x630 progressive JPEG, write it, and
 *               record the photographer in CREDITS.json. Idempotent — existing
 *               files are skipped. Pass a slug as an arg to force a re-fetch:
 *                   node scripts/destination-covers.mjs houston
 *
 * Adding a destination to data.ts is the only manual step. `--check` fails the
 * build until its cover exists; `npm run covers:backfill` fetches it.
 */
import { readFileSync, existsSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
// COVERS_DATA_TS is a test seam (point the parser at a fixture); defaults to the real data.
const DATA_TS = process.env.COVERS_DATA_TS || join(ROOT, "lib", "destinations", "data.ts");
const COVER_DIR = join(ROOT, "public", "images", "destinations");
const W = 1200;
const H = 630;

// Optional query hints for cities whose bare name returns weak stock photos.
// NOT a source of truth — slugs always come from data.ts. Anything not listed
// falls back to a derived `"<name> <country> skyline cityscape"` query.
const QUERY_OVERRIDES = {
  benidorm: "Benidorm Spain skyline beach skyscrapers",
  bordeaux: "Bordeaux France place de la bourse river",
  budapest: "Budapest parliament Danube river",
  "hong-kong": "Hong Kong skyline Victoria Harbour",
  houston: "Houston Texas downtown skyline golden hour",
  lima: "Lima Peru Miraflores coast cliffs",
  nairobi: "Nairobi Kenya city skyline",
  taipei: "Taipei Taiwan skyline Taipei 101",
  xiamen: "Xiamen China coast city skyline",
};

/**
 * Parse {slug, name, country} for every destination, straight from data.ts.
 *
 * The guard MUST see exactly the slugs the renderer renders (getAllSlugs() ->
 * destinations.map(d => d.slug)), or a coverless destination could ship behind
 * the gradient. So this is deliberately strict and fails LOUD rather than
 * silently skipping anything it can't understand:
 *  - it matches destination-level `slug:` properties (4-space indent), which
 *    excludes the `slug: string` type annotations elsewhere in the file;
 *  - it cross-checks the slug count against the `countryCode` count (every
 *    destination has exactly one), so a mis-indented/garbled slug can't pass;
 *  - it requires every slug to be a plain lowercase-hyphen string literal —
 *    an uppercase, accented, underscored, computed, or interpolated slug
 *    THROWS (the renderer would build a 404 cover URL from it).
 */
function parseDestinations() {
  const src = readFileSync(DATA_TS, "utf8");
  const slugLines = [...src.matchAll(/^ {4}slug:[ \t]*(.+?),?[ \t]*$/gm)];
  const countryCodeCount = (src.match(/^ {4}countryCode:/gm) || []).length;

  if (slugLines.length < 20) {
    throw new Error(
      `Parsed only ${slugLines.length} destination slugs from data.ts — the parser is out of date with the data format (expected 4-space-indented \`slug:\` properties).`
    );
  }
  if (slugLines.length !== countryCodeCount) {
    throw new Error(
      `data.ts has ${slugLines.length} slug properties but ${countryCodeCount} countryCode properties — a destination did not parse cleanly. Check the data formatting.`
    );
  }

  return slugLines.map((m, i) => {
    const raw = m[1].trim();
    const lit = raw.match(/^(['"`])([a-z0-9-]+)\1$/);
    if (!lit) {
      throw new Error(
        `Destination slug ${JSON.stringify(raw)} is not a plain lowercase-hyphen string literal.\n` +
        `  Covers are served from public/images/destinations/<slug>.jpg built from the literal slug,\n` +
        `  so a computed, interpolated, uppercase, accented, or otherwise non-[a-z0-9-] slug cannot be\n` +
        `  verified (and would 404 on a case-sensitive filesystem). Fix the slug in lib/destinations/data.ts.`
      );
    }
    const slug = lit[2];
    const chunk = src.slice(
      m.index,
      i + 1 < slugLines.length ? slugLines[i + 1].index : src.length
    );
    const name =
      (chunk.match(/name:\s*\{[\s\S]*?en:\s*"([^"]+)"/) || [])[1] ||
      slug.replace(/-/g, " ");
    const country =
      (chunk.match(/country:\s*\{[\s\S]*?en:\s*"([^"]+)"/) || [])[1] || "";
    return { slug, name, country };
  });
}

const coverPath = (slug) => join(COVER_DIR, `${slug}.jpg`);

function check() {
  const dests = parseDestinations();
  const missing = dests.filter((d) => !existsSync(coverPath(d.slug)));
  if (missing.length) {
    console.error(
      `\n✗ destination covers: ${missing.length} missing of ${dests.length}\n`
    );
    for (const d of missing) {
      console.error(`  • ${d.slug}  ->  public/images/destinations/${d.slug}.jpg`);
    }
    console.error(
      `\n  Fix: npm run covers:backfill   (fetches the missing photo(s); then commit them)\n`
    );
    process.exit(1);
  }
  console.log(`✓ destination covers: ${dests.length}/${dests.length} present`);
}

function readCredits() {
  try {
    const arr = JSON.parse(readFileSync(join(COVER_DIR, "CREDITS.json"), "utf8"));
    return Object.fromEntries(arr.map((c) => [c.slug, c]));
  } catch {
    return {};
  }
}

function writeCredits(map) {
  const arr = Object.values(map).sort((a, b) => a.slug.localeCompare(b.slug));
  writeFileSync(
    join(COVER_DIR, "CREDITS.json"),
    JSON.stringify(arr, null, 2) + "\n"
  );
}

async function backfill() {
  const force = new Set(
    process.argv.slice(2).filter((a) => !a.startsWith("--"))
  );
  const dests = parseDestinations();
  const todo = dests.filter(
    (d) => force.has(d.slug) || !existsSync(coverPath(d.slug))
  );
  if (!todo.length) {
    console.log(
      `Nothing to do — all ${dests.length} covers present. (pass a slug to force a re-fetch)`
    );
    return;
  }
  const KEY = process.env.PEXELS_API_KEY;
  if (!KEY) {
    console.error("PEXELS_API_KEY is required in the environment for backfill.");
    process.exit(1);
  }
  const sharp = (await import("sharp")).default;
  const credits = readCredits();
  let ok = 0;
  for (const d of todo) {
    const query =
      QUERY_OVERRIDES[d.slug] ||
      `${d.name} ${d.country} skyline cityscape`.trim();
    try {
      const res = await fetch(
        `https://api.pexels.com/v1/search?query=${encodeURIComponent(
          query
        )}&orientation=landscape&size=large&per_page=5`,
        { headers: { Authorization: KEY } }
      );
      if (!res.ok) throw new Error(`Pexels ${res.status}`);
      const photo = (await res.json()).photos?.[0];
      if (!photo) throw new Error("no results");
      const imgRes = await fetch(photo.src.large2x || photo.src.original);
      if (!imgRes.ok) throw new Error(`download ${imgRes.status}`);
      const buf = Buffer.from(await imgRes.arrayBuffer());
      await sharp(buf)
        .resize(W, H, { fit: "cover", position: sharp.strategy.attention })
        .jpeg({ quality: 80, progressive: true })
        .toFile(coverPath(d.slug));
      credits[d.slug] = {
        slug: d.slug,
        photographer: photo.photographer,
        url: photo.url,
        pexels_id: photo.id,
        query,
      };
      const kb = Math.round(statSync(coverPath(d.slug)).size / 1024);
      console.log(`OK   ${d.slug}: "${query}" -> ${photo.photographer} (${kb} KB)`);
      ok++;
    } catch (e) {
      console.error(`FAIL ${d.slug}: ${e.message}`);
    }
  }
  writeCredits(credits);
  console.log(
    `\nFetched ${ok}/${todo.length}. Review the new cover(s), commit them, then 'npm run covers:check'.`
  );
}

const mode = process.argv[2];
if (mode === "--check") check();
else if (mode === "--list") console.log(parseDestinations().map((d) => d.slug).join("\n"));
else await backfill();
