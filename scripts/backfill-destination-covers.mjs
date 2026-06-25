/**
 * Backfill missing destination cover images from Pexels.
 *
 * The site ships curated 1200x630 JPEG covers at public/images/destinations/<slug>.jpg.
 * A handful of destinations never had a cover shot, so they fell back to a gradient.
 * This sources a real, license-clear photo (Pexels — free, commercial use, no
 * attribution required) for each missing slug and writes it at the exact format/size
 * the existing covers use, so they're indistinguishable from the hand-picked ones.
 *
 * Usage:  PEXELS_API_KEY=xxx node scripts/backfill-destination-covers.mjs [slug ...]
 *   - With no args, fetches every slug in CITY_QUERIES that has no file yet.
 *   - With slug args, re-fetches just those (overwrites), e.g. for a bad crop.
 *
 * Requires Node 18+ (global fetch) and sharp (already a dependency).
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const KEY = process.env.PEXELS_API_KEY;
if (!KEY) {
  console.error("PEXELS_API_KEY is required in the environment.");
  process.exit(1);
}

const OUT_DIR = "public/images/destinations";
const W = 1200;
const H = 630;

// Curated, landmark-anchored queries so Pexels returns THIS city, not a generic one.
const CITY_QUERIES = {
  benidorm: "Benidorm Spain skyline beach skyscrapers",
  bordeaux: "Bordeaux France place de la bourse river",
  budapest: "Budapest parliament Danube river",
  "hong-kong": "Hong Kong skyline Victoria Harbour",
  houston: "Houston Texas downtown skyline",
  lima: "Lima Peru Miraflores coast cliffs",
  nairobi: "Nairobi Kenya city skyline",
  taipei: "Taipei Taiwan skyline Taipei 101",
  xiamen: "Xiamen China coast city skyline",
};

const argSlugs = process.argv.slice(2);

async function pexelsTop(query) {
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(
    query
  )}&orientation=landscape&size=large&per_page=5`;
  const res = await fetch(url, { headers: { Authorization: KEY } });
  if (!res.ok) throw new Error(`Pexels ${res.status}`);
  const json = await res.json();
  const photo = json.photos?.[0];
  if (!photo) throw new Error("no results");
  return photo;
}

async function run() {
  const credits = [];
  const slugs = argSlugs.length ? argSlugs : Object.keys(CITY_QUERIES);
  for (const slug of slugs) {
    const query = CITY_QUERIES[slug];
    if (!query) {
      console.log(`SKIP ${slug}: no query defined`);
      continue;
    }
    const outPath = path.join(OUT_DIR, `${slug}.jpg`);
    if (!argSlugs.length && fs.existsSync(outPath)) {
      console.log(`HAVE ${slug}: already exists, skipping`);
      continue;
    }
    try {
      const photo = await pexelsTop(query);
      const srcUrl = photo.src.large2x || photo.src.original;
      const imgRes = await fetch(srcUrl);
      if (!imgRes.ok) throw new Error(`download ${imgRes.status}`);
      const buf = Buffer.from(await imgRes.arrayBuffer());
      await sharp(buf)
        .resize(W, H, { fit: "cover", position: sharp.strategy.attention })
        .jpeg({ quality: 80, progressive: true })
        .toFile(outPath);
      const kb = Math.round(fs.statSync(outPath).size / 1024);
      credits.push({
        slug,
        photographer: photo.photographer,
        url: photo.url,
        pexels_id: photo.id,
      });
      console.log(`OK   ${slug}: "${query}" -> ${photo.photographer} (${kb} KB)`);
    } catch (e) {
      console.log(`FAIL ${slug}: ${e.message}`);
    }
  }
  // Append to a credits ledger (Pexels doesn't require it; we keep it anyway).
  const ledgerPath = path.join(OUT_DIR, "CREDITS.json");
  let existing = [];
  try {
    existing = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
  } catch {}
  const bySlug = Object.fromEntries(existing.map((c) => [c.slug, c]));
  for (const c of credits) bySlug[c.slug] = c;
  fs.writeFileSync(
    ledgerPath,
    JSON.stringify(Object.values(bySlug).sort((a, b) => a.slug.localeCompare(b.slug)), null, 2) + "\n"
  );
  console.log(`\nWrote ${credits.length} cover(s). Credits ledger: ${ledgerPath}`);
}

run();
