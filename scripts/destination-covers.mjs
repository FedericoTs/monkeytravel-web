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
const DATA_TS = join(ROOT, "lib", "destinations", "data.ts");
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

/** Parse {slug, name, country} for every destination, straight from data.ts. */
function parseDestinations() {
  const src = readFileSync(DATA_TS, "utf8");
  const matches = [...src.matchAll(/\bslug:\s*"([a-z0-9-]+)"/g)];
  if (matches.length === 0) {
    throw new Error(
      `Parsed 0 destinations from ${DATA_TS} — the parser is out of date with the data format.`
    );
  }
  return matches.map((m, i) => {
    const slug = m[1];
    const chunk = src.slice(
      m.index,
      i + 1 < matches.length ? matches[i + 1].index : src.length
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
