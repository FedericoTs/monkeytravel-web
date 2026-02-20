/**
 * Fetch high-quality blog cover images from Pexels API.
 * Replaces placeholder gradient images (< 60KB) with real photos.
 * Resizes to 1200x630 using sharp.
 *
 * Usage: PEXELS_API_KEY=xxx node scripts/fetch-blog-images.mjs
 *   or: source .env.local && node scripts/fetch-blog-images.mjs
 */

import { writeFile, mkdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const API_KEY = process.env.PEXELS_API_KEY;
if (!API_KEY) {
  console.error("❌ PEXELS_API_KEY environment variable is required");
  process.exit(1);
}

const OUT_DIR = join(process.cwd(), "public/images/blog");
const PEXELS_API = "https://api.pexels.com/v1/search";
const MAX_PLACEHOLDER_SIZE = 60_000; // Files under 60KB are considered placeholders

// Map each blog slug to a descriptive Pexels search query
const BLOG_QUERIES = {
  // Phase 1B - Itineraries
  "3-day-paris-itinerary": "Paris Eiffel Tower cityscape",
  "5-day-italy-itinerary": "Italy Rome Colosseum travel",
  "bali-7-day-itinerary": "Bali rice terraces temple",
  "tokyo-4-day-itinerary": "Tokyo Shibuya neon cityscape",
  "barcelona-3-day-itinerary": "Barcelona Sagrada Familia architecture",

  // Phase 3 - Seasonal/Natural events
  "best-places-to-see-northern-lights": "northern lights aurora borealis sky",
  "japan-cherry-blossom-season-guide": "cherry blossom Japan sakura spring",
  "best-fall-foliage-destinations": "autumn fall foliage colorful forest",
  "great-migration-africa-when-and-where": "wildebeest migration Africa savanna",
  "midnight-sun-best-destinations": "midnight sun Norway Arctic summer",
  "monsoon-season-where-to-go-and-avoid": "monsoon rain tropical Asia",

  // Phase 4 - More itineraries
  "london-4-day-itinerary": "London Big Ben Thames cityscape",
  "new-york-5-day-itinerary": "New York Manhattan skyline",
  "istanbul-3-day-itinerary": "Istanbul Blue Mosque Bosphorus",
  "lisbon-3-day-itinerary": "Lisbon tram colorful buildings",
  "bangkok-5-day-itinerary": "Bangkok temple golden sunset",

  // Phase 4 - Comparison/Best-of
  "bali-vs-thailand": "tropical beach paradise palm trees",
  "paris-vs-rome": "European architecture romantic cityscape",
  "cheapest-destinations-in-europe": "colorful European village budget travel",
  "cheapest-destinations-in-asia": "Asian street market vibrant food",
  "best-summer-destinations-2026": "summer beach Mediterranean blue water",

  // Phase 5 - Monthly guides
  "where-to-go-in-march": "spring travel cherry blossom destination",
  "where-to-go-in-june": "summer Mediterranean coast travel",
  "where-to-go-in-september": "autumn shoulder season European city",
  "where-to-go-in-december": "Christmas market winter travel snow",
  "travel-packing-checklist": "travel suitcase packing luggage",
  "international-travel-checklist": "passport boarding pass travel documents",

  // Phase 6 - Passport/Visa + remaining months
  "passport-power-index-2026": "passport travel world map stamps",
  "visa-free-destinations-by-passport": "airport travel international departure",
  "visa-requirements-us-citizens": "US passport travel visa stamps",
  "where-to-go-in-january": "winter sun tropical beach escape",
  "where-to-go-in-april": "spring tulips Amsterdam colorful",
  "where-to-go-in-july": "peak summer Greek island coast",
  "where-to-go-in-october": "fall foliage autumn destination travel",
  "where-to-go-in-november": "shoulder season temple warm travel",
};

async function fetchPexels(query) {
  const url = `${PEXELS_API}?query=${encodeURIComponent(query)}&per_page=15&orientation=landscape&size=large`;
  const res = await fetch(url, {
    headers: { Authorization: API_KEY },
  });

  if (!res.ok) {
    throw new Error(`Pexels API error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  if (!data.photos || data.photos.length === 0) {
    return null;
  }

  // Pick the best photo: prefer wider aspect ratios and larger images
  // Filter for photos that are landscape-oriented (width > height)
  const landscape = data.photos.filter((p) => p.width > p.height);
  const candidates = landscape.length > 0 ? landscape : data.photos;

  // Pick from top 3 by size for variety but quality
  const top = candidates.slice(0, 3);
  const pick = top[Math.floor(Math.random() * top.length)];

  return pick.src.large2x || pick.src.large || pick.src.original;
}

async function downloadAndResize(imageUrl, outputPath) {
  const res = await fetch(imageUrl, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} downloading image`);

  const buffer = Buffer.from(await res.arrayBuffer());

  await sharp(buffer)
    .resize(1200, 630, { fit: "cover", position: "centre" })
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(outputPath);
}

async function isPlaceholder(filePath) {
  if (!existsSync(filePath)) return true;
  const stats = await stat(filePath);
  return stats.size < MAX_PLACEHOLDER_SIZE;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const slugs = Object.keys(BLOG_QUERIES);
  let replaced = 0;
  let skipped = 0;
  let failed = 0;

  console.log(`\n🖼️  Fetching blog images from Pexels (${slugs.length} posts)\n`);

  for (const slug of slugs) {
    const outPath = join(OUT_DIR, `${slug}.jpg`);
    const query = BLOG_QUERIES[slug];

    // Check if current image is already a real photo (> 60KB)
    if (!(await isPlaceholder(outPath))) {
      console.log(`⏭  ${slug} — already has real image, skipping`);
      skipped++;
      continue;
    }

    console.log(`📥 ${slug} — searching "${query}"...`);

    try {
      const imageUrl = await fetchPexels(query);

      if (!imageUrl) {
        console.log(`   ❌ No results for "${query}"`);
        failed++;
        continue;
      }

      await downloadAndResize(imageUrl, outPath);

      const stats = await stat(outPath);
      const sizeKB = Math.round(stats.size / 1024);
      console.log(`   ✅ ${slug}.jpg (${sizeKB}KB, 1200×630)`);
      replaced++;
    } catch (err) {
      console.log(`   ❌ ${slug} failed: ${err.message}`);
      failed++;
    }

    // Rate limit: 200 requests/hour for Pexels free tier
    await new Promise((r) => setTimeout(r, 400));
  }

  console.log(`\n✅ Done: ${replaced} replaced, ${skipped} skipped, ${failed} failed out of ${slugs.length}\n`);
}

main();
