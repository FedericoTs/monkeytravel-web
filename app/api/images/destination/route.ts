import { NextRequest } from "next/server";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { PEXELS_API_BASE } from "@/lib/constants/externalApis";

// Pexels API endpoint
const PEXELS_API_URL = `${PEXELS_API_BASE}/search`;

// Cache for destination images (in-memory, per-instance)
// In production, you'd use Redis or similar
const imageCache = new Map<string, { url: string; timestamp: number }>();
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days - images rarely change

// Curated high-quality destination images.
//
// HISTORY, and the lesson in it: this map was originally annotated "These are
// stable Pexels URLs that won't change" — false, Pexels deletes and rotates
// images. A 2026-05-28 audit removed 4 IDs that had become 404.
//
// That audit checked only that each URL RESOLVED, which turned out to be the
// wrong question. A 2026-07-21 audit opened all 73 images and looked at them:
// 20 showed the wrong place and 5 were unusable. Venice was the London Eye,
// Boston was Big Ben, Budapest was Rio de Janeiro, Milan was a macro shot of a
// wet leaf, Naples was a pond insect, and Cairo was Pexels' own grey
// "missing image" placeholder — which is served with HTTP 200, so every
// existence check had passed it. Kyoto and Osaka were effectively swapped.
// All 25 were replaced with photos that were individually verified by eye.
//
// SO: when re-validating, a 200 response proves nothing. Look at the picture.
// design/audit/probe-images.mjs checks resolution and intra-map duplicates;
// content still needs human (or vision-model) eyes.
const CURATED_DESTINATIONS: Record<string, string> = {
  // Major Cities
  paris: "https://images.pexels.com/photos/338515/pexels-photo-338515.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  tokyo: "https://images.pexels.com/photos/2614818/pexels-photo-2614818.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  rome: "https://images.pexels.com/photos/532263/pexels-photo-532263.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  "new york": "https://images.pexels.com/photos/802024/pexels-photo-802024.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  london: "https://images.pexels.com/photos/460672/pexels-photo-460672.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  barcelona: "https://images.pexels.com/photos/1388030/pexels-photo-1388030.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  amsterdam: "https://images.pexels.com/photos/1414467/pexels-photo-1414467.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  dubai: "https://images.pexels.com/photos/1470502/pexels-photo-1470502.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  sydney: "https://images.pexels.com/photos/995764/pexels-photo-995764.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  singapore: "https://images.pexels.com/photos/777059/pexels-photo-777059.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  bangkok: "https://images.pexels.com/photos/1031659/pexels-photo-1031659.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  "hong kong": "https://images.pexels.com/photos/1738986/pexels-photo-1738986.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  venice: "https://images.pexels.com/photos/29487687/pexels-photo-29487687.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  florence: "https://images.pexels.com/photos/2422461/pexels-photo-2422461.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  prague: "https://images.pexels.com/photos/11261851/pexels-photo-11261851.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  vienna: "https://images.pexels.com/photos/2351425/pexels-photo-2351425.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  lisbon: "https://images.pexels.com/photos/1534560/pexels-photo-1534560.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  madrid: "https://images.pexels.com/photos/3254729/pexels-photo-3254729.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  berlin: "https://images.pexels.com/photos/1128408/pexels-photo-1128408.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  munich: "https://images.pexels.com/photos/13762982/pexels-photo-13762982.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  milan: "https://images.pexels.com/photos/27362357/pexels-photo-27362357.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  zurich: "https://images.pexels.com/photos/34007139/pexels-photo-34007139.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  athens: "https://images.pexels.com/photos/772689/pexels-photo-772689.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  cairo: "https://images.pexels.com/photos/34812111/pexels-photo-34812111.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  istanbul: "https://images.pexels.com/photos/18192823/pexels-photo-18192823.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  moscow: "https://images.pexels.com/photos/236294/pexels-photo-236294.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  seoul: "https://images.pexels.com/photos/37436233/pexels-photo-37436233.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  beijing: "https://images.pexels.com/photos/2846076/pexels-photo-2846076.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  shanghai: "https://images.pexels.com/photos/683419/pexels-photo-683419.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",

  // Beach/Island destinations
  bali: "https://images.pexels.com/photos/2166559/pexels-photo-2166559.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  maldives: "https://images.pexels.com/photos/1483053/pexels-photo-1483053.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  hawaii: "https://images.pexels.com/photos/15989886/pexels-photo-15989886.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  santorini: "https://images.pexels.com/photos/1010657/pexels-photo-1010657.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  phuket: "https://images.pexels.com/photos/1078983/pexels-photo-1078983.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  cancun: "https://images.pexels.com/photos/994605/pexels-photo-994605.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",

  // Countries (for broader searches)
  italy: "https://images.pexels.com/photos/1701595/pexels-photo-1701595.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  france: "https://images.pexels.com/photos/2363/france-landmark-lights-night.jpg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  japan: "https://images.pexels.com/photos/590478/pexels-photo-590478.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  spain: "https://images.pexels.com/photos/819764/pexels-photo-819764.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  greece: "https://images.pexels.com/photos/1285625/pexels-photo-1285625.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  thailand: "https://images.pexels.com/photos/35993701/pexels-photo-35993701.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  indonesia: "https://images.pexels.com/photos/2474689/pexels-photo-2474689.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  australia: "https://images.pexels.com/photos/2193300/pexels-photo-2193300.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  germany: "https://images.pexels.com/photos/109629/pexels-photo-109629.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  portugal: "https://images.pexels.com/photos/1534560/pexels-photo-1534560.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",

  // US Cities
  "los angeles": "https://images.pexels.com/photos/2695679/pexels-photo-2695679.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  "san francisco": "https://images.pexels.com/photos/208745/pexels-photo-208745.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  chicago: "https://images.pexels.com/photos/1823681/pexels-photo-1823681.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  miami: "https://images.pexels.com/photos/11457818/pexels-photo-11457818.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  "las vegas": "https://images.pexels.com/photos/415999/pexels-photo-415999.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  boston: "https://images.pexels.com/photos/21314036/pexels-photo-21314036.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  seattle: "https://images.pexels.com/photos/1796730/pexels-photo-1796730.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  washington: "https://images.pexels.com/photos/7017012/pexels-photo-7017012.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",

  // European cities
  budapest: "https://images.pexels.com/photos/18806130/pexels-photo-18806130.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  copenhagen: "https://images.pexels.com/photos/416024/pexels-photo-416024.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  stockholm: "https://images.pexels.com/photos/19391718/pexels-photo-19391718.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  oslo: "https://images.pexels.com/photos/18170373/pexels-photo-18170373.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  helsinki: "https://images.pexels.com/photos/17408748/pexels-photo-17408748.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  dublin: "https://images.pexels.com/photos/2416653/pexels-photo-2416653.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  // edinburgh: removed 2026-05-28 — pexels id 803512 returns 404.
  brussels: "https://images.pexels.com/photos/1595085/pexels-photo-1595085.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",

  // Italian cities
  naples: "https://images.pexels.com/photos/12496244/pexels-photo-12496244.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  amalfi: "https://images.pexels.com/photos/12464291/pexels-photo-12464291.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  // trieste: removed 2026-05-28 — pexels id 5007066 returns 404.

  // Asian cities
  kyoto: "https://images.pexels.com/photos/33229939/pexels-photo-33229939.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  osaka: "https://images.pexels.com/photos/30957218/pexels-photo-30957218.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  hanoi: "https://images.pexels.com/photos/34277875/pexels-photo-34277875.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  // "ho chi minh": removed 2026-05-28 — pexels id 3019797 returns 404.
  taipei: "https://images.pexels.com/photos/28617722/pexels-photo-28617722.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  mumbai: "https://images.pexels.com/photos/6522114/pexels-photo-6522114.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  delhi: "https://images.pexels.com/photos/789750/pexels-photo-789750.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",

  // South America
  "rio de janeiro": "https://images.pexels.com/photos/2868242/pexels-photo-2868242.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  "buenos aires": "https://images.pexels.com/photos/1060803/pexels-photo-1060803.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  lima: "https://images.pexels.com/photos/7357663/pexels-photo-7357663.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  "machu picchu": "https://images.pexels.com/photos/2356045/pexels-photo-2356045.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",

  // Africa
  marrakech: "https://images.pexels.com/photos/3889843/pexels-photo-3889843.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  "cape town": "https://images.pexels.com/photos/259447/pexels-photo-259447.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",

  // Restored / added 2026-07-21. The first four were deleted by the 404 sweep
  // and never replaced, so trips to them fell through to a live Pexels search
  // — which is what put a photo of London on a Trieste trip. The rest are
  // destinations real published trips point at. Every one was chosen by
  // looking at the candidates, not by trusting the search ranking.
  edinburgh: "https://images.pexels.com/photos/21235066/pexels-photo-21235066.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  trieste: "https://images.pexels.com/photos/29336031/pexels-photo-29336031.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  "ho chi minh": "https://images.pexels.com/photos/32755075/pexels-photo-32755075.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  montreal: "https://images.pexels.com/photos/2889701/pexels-photo-2889701.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  benidorm: "https://images.pexels.com/photos/33739349/pexels-photo-33739349.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  torremolinos: "https://images.pexels.com/photos/16753341/pexels-photo-16753341.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  "grand baie": "https://images.pexels.com/photos/11043356/pexels-photo-11043356.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  "kruger national park": "https://images.pexels.com/photos/631317/pexels-photo-631317.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  puglia: "https://images.pexels.com/photos/19143328/pexels-photo-19143328.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
};

// Generic travel fallback
const FALLBACK_IMAGE = "https://images.pexels.com/photos/2007401/pexels-photo-2007401.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop";

/**
 * Normalizes destination name for matching
 */
function normalizeDestination(destination: string): string {
  return destination
    .toLowerCase()
    .replace(/[,.].*$/, "") // Remove country/region after comma
    .replace(/\s+trip$/i, "") // Remove "trip" suffix
    .replace(/\s+city$/i, "") // Remove "city" suffix
    .trim();
}

/**
 * Find curated image for destination.
 *
 * Matching is deliberately conservative. The previous version accepted
 * `key.includes(normalized)` — a SHORTER destination inheriting a LONGER key —
 * which silently sent Nice, France to the Venice photo, because "venice"
 * contains "nice". The same rule mapped the Isle of Man onto Germany. A wrong
 * photo is worse than no photo: no photo falls through to a live Pexels search
 * for the actual destination, whereas a wrong one is confidently incorrect and
 * (until the fix in persistTrip) got written to the row permanently.
 *
 * So: exact match, or the key appearing in the destination on WORD boundaries
 * ("paris, france" -> paris; "greater london" -> london). Never the reverse.
 */
function findCuratedImage(destination: string): string | null {
  const normalized = normalizeDestination(destination);

  if (CURATED_DESTINATIONS[normalized]) {
    return CURATED_DESTINATIONS[normalized];
  }

  const words = new Set(normalized.split(/[\s-]+/).filter(Boolean));
  for (const [key, url] of Object.entries(CURATED_DESTINATIONS)) {
    const keyWords = key.split(/[\s-]+/).filter(Boolean);
    if (keyWords.every((w) => words.has(w))) {
      return url;
    }
  }

  return null;
}

/**
 * Fetch image from Pexels API
 */
async function fetchFromPexels(destination: string): Promise<string | null> {
  const apiKey = process.env.PEXELS_API_KEY;

  if (!apiKey) {
    console.warn("[Images Destination] PEXELS_API_KEY not configured");
    return null;
  }

  try {
    const query = encodeURIComponent(`${destination} travel landmark city`);
    const response = await fetch(
      `${PEXELS_API_URL}?query=${query}&per_page=5&orientation=landscape`,
      {
        headers: {
          Authorization: apiKey,
        },
      }
    );

    if (!response.ok) {
      console.error("[Images Destination] Pexels API error:", response.status);
      return null;
    }

    const data = await response.json();

    if (data.photos && data.photos.length > 0) {
      // Pick from the top 5 deterministically, seeded by the destination name.
      // Math.random() here meant the same destination could resolve to a
      // different photo on every call — and because the cache is per-instance,
      // two serverless instances would disagree. Anything that persisted the
      // result then froze whichever photo it happened to get. Hashing the name
      // keeps variety ACROSS destinations while being stable FOR one.
      const pool = Math.min(data.photos.length, 5);
      let hash = 0;
      for (let i = 0; i < destination.length; i++) {
        hash = (hash * 31 + destination.charCodeAt(i)) | 0;
      }
      const photo = data.photos[Math.abs(hash) % pool];

      // Use the "large" size for good quality without being too heavy
      return photo.src.large || photo.src.medium || photo.src.original;
    }

    return null;
  } catch (error) {
    console.error("[Images Destination] Error fetching from Pexels:", error);
    return null;
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const destination = searchParams.get("destination");

  if (!destination) {
    return errors.badRequest("Destination parameter is required");
  }

  const cacheKey = normalizeDestination(destination);

  // Cache-Control headers for CDN caching at Vercel Edge (reduces server requests by 50%+)
  // Extended to 48h for better cost efficiency - destination images rarely change
  const cacheHeaders = {
    "Cache-Control": "public, s-maxage=172800, stale-while-revalidate=86400", // 48h CDN, 24h stale
  };

  // Check cache first
  const cached = imageCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return apiSuccess({
      url: cached.url,
      source: "cache",
      destination: cacheKey
    }, { headers: cacheHeaders });
  }

  // Try curated images first (fastest, most reliable)
  const curatedUrl = findCuratedImage(destination);
  if (curatedUrl) {
    imageCache.set(cacheKey, { url: curatedUrl, timestamp: Date.now() });
    return apiSuccess({
      url: curatedUrl,
      source: "curated",
      destination: cacheKey
    }, { headers: cacheHeaders });
  }

  // Try Pexels API for uncurated destinations
  const pexelsUrl = await fetchFromPexels(destination);
  if (pexelsUrl) {
    imageCache.set(cacheKey, { url: pexelsUrl, timestamp: Date.now() });
    return apiSuccess({
      url: pexelsUrl,
      source: "pexels",
      destination: cacheKey
    }, { headers: cacheHeaders });
  }

  // Fallback to generic travel image
  return apiSuccess({
    url: FALLBACK_IMAGE,
    source: "fallback",
    destination: cacheKey
  }, { headers: cacheHeaders });
}

export async function POST(request: NextRequest) {
  try {
    const { destination } = await request.json();

    if (!destination) {
      return errors.badRequest("Destination is required");
    }

    // Redirect to GET with destination as query param
    const url = new URL(request.url);
    url.searchParams.set("destination", destination);

    return GET(new NextRequest(url));
  } catch {
    return errors.badRequest("Invalid request body");
  }
}
