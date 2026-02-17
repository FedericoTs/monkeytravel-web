/**
 * Fetch destination images from Wikipedia (free, no API key).
 * Downloads the main article image for each destination,
 * then resizes to 1200x630 using sharp.
 *
 * Usage: node scripts/fetch-destination-images.mjs
 */

import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const OUT_DIR = join(process.cwd(), "public/images/destinations");

// Map slugs to Wikipedia article titles for best image match
const DESTINATIONS = {
  paris: "Paris",
  rome: "Rome",
  barcelona: "Barcelona",
  tokyo: "Tokyo",
  "new-york": "New York City",
  london: "London",
  amsterdam: "Amsterdam",
  prague: "Prague",
  lisbon: "Lisbon",
  vienna: "Vienna",
  berlin: "Berlin",
  bangkok: "Bangkok",
  bali: "Bali",
  seoul: "Seoul",
  singapore: "Singapore",
  cancun: "Cancún",
  "rio-de-janeiro": "Rio de Janeiro",
  dubai: "Dubai",
  istanbul: "Istanbul",
  marrakech: "Marrakech",
};

// Fallback: curated Wikimedia Commons filenames per city
// (used when Wikipedia summary image is a coat of arms / map / flag)
const WIKIMEDIA_FALLBACKS = {
  paris: "Tour_Eiffel_Wikimedia_Commons_(cropped).jpg",
  rome: "Roman_Forum_from_Palatine_Hill_-_panoramio.jpg",
  barcelona: "Basilica_de_la_Sagrada_Familia_-_panoramio_(4).jpg",
  tokyo: "Skyscrapers_of_Shinjuku_2009_January.jpg",
  "new-york": "NYC_wbread_-_Empire_State_Building.jpg",
  london: "Palace_of_Westminster_from_the_dome_on_Methodist_Central_Hall.jpg",
  amsterdam: "KeizsGracht_Amsterdam.jpg",
  prague: "Prague_old_town_tower_view.jpg",
  lisbon: "Lisbon_(36831596786)_(cropped).jpg",
  vienna: "Wien_-_Schloss_Sch%C3%B6nbrunn.jpg",
  berlin: "Brandenburger_Tor_abends.jpg",
  bangkok: "Wat_Arun_Bangkok.jpg",
  bali: "Tanah-Lot_Bali_Indonesia_Pura-Tanah-Lot-01.jpg",
  seoul: "Seoul_skyline_at_night.jpg",
  singapore: "1_singapore_city_skyline_dusk_panorama_2011.jpg",
  cancun: "Cancun_aerial_photo_by_safa.jpg",
  "rio-de-janeiro": "Christ_on_Corcovado_mountain.JPG",
  dubai: "Dubai_skyline_2015_(crop).jpg",
  istanbul: "Istanbul_skyline.jpg",
  marrakech: "Jemaa-el-Fna.jpg",
};

async function fetchJSON(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "MonkeyTravel/1.0 (destination-images)" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function fetchImageBuffer(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "MonkeyTravel/1.0 (destination-images)" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} downloading ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Try to get image from Wikipedia REST API summary endpoint.
 * Returns the image URL or null if it looks like a non-photo (coat of arms, map).
 */
async function getWikipediaImageUrl(articleTitle) {
  try {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(articleTitle)}`;
    const data = await fetchJSON(url);

    if (data.originalimage?.source) {
      const src = data.originalimage.source.toLowerCase();
      // Skip coat of arms, flags, maps, logos, icons
      if (
        /(coat_of_arms|escudo|blason|wappen|flag_of|map_of|logo|icon|seal_of)/i.test(
          src
        )
      ) {
        return null;
      }
      return data.originalimage.source;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Build Wikimedia Commons direct URL from filename.
 */
function getWikimediaCommonsUrl(filename) {
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${filename}?width=1600`;
}

/**
 * Download, resize to 1200x630, save as JPEG.
 */
async function processImage(buffer, outputPath) {
  await sharp(buffer)
    .resize(1200, 630, { fit: "cover", position: "centre" })
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(outputPath);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const slugs = Object.keys(DESTINATIONS);
  let success = 0;
  let failed = 0;

  for (const slug of slugs) {
    const outPath = join(OUT_DIR, `${slug}.jpg`);

    // Skip if already exists
    if (existsSync(outPath)) {
      console.log(`⏭  ${slug} — already exists, skipping`);
      success++;
      continue;
    }

    console.log(`📥 ${slug} — fetching...`);

    try {
      // Try Wikipedia summary image first
      let imageUrl = await getWikipediaImageUrl(DESTINATIONS[slug]);

      if (!imageUrl && WIKIMEDIA_FALLBACKS[slug]) {
        console.log(`   ↳ Wikipedia image not suitable, using Wikimedia Commons fallback`);
        imageUrl = getWikimediaCommonsUrl(WIKIMEDIA_FALLBACKS[slug]);
      }

      if (!imageUrl) {
        console.log(`   ❌ No image found for ${slug}`);
        failed++;
        continue;
      }

      const buffer = await fetchImageBuffer(imageUrl);
      await processImage(buffer, outPath);

      console.log(`   ✅ saved ${slug}.jpg (1200×630)`);
      success++;
    } catch (err) {
      console.log(`   ❌ ${slug} failed: ${err.message}`);
      failed++;
    }

    // Small delay to be polite to Wikipedia's servers
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`\nDone: ${success} succeeded, ${failed} failed out of ${slugs.length}`);
}

main();
