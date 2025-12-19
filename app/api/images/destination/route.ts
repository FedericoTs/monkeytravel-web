import { NextRequest, NextResponse } from "next/server";

// Pexels API endpoint
const PEXELS_API_URL = "https://api.pexels.com/v1/search";

// Cache for destination images (in-memory, per-instance)
// In production, you'd use Redis or similar
const imageCache = new Map<string, { url: string; timestamp: number }>();
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days - images rarely change

// Curated high-quality destination images as fallbacks
// These are stable Pexels URLs that won't change
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
  venice: "https://images.pexels.com/photos/1796715/pexels-photo-1796715.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  florence: "https://images.pexels.com/photos/2422461/pexels-photo-2422461.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  prague: "https://images.pexels.com/photos/161077/building-czech-prague-architecture-161077.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  vienna: "https://images.pexels.com/photos/2351425/pexels-photo-2351425.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  lisbon: "https://images.pexels.com/photos/1534560/pexels-photo-1534560.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  madrid: "https://images.pexels.com/photos/3254729/pexels-photo-3254729.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  berlin: "https://images.pexels.com/photos/1128408/pexels-photo-1128408.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  munich: "https://images.pexels.com/photos/109629/pexels-photo-109629.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  milan: "https://images.pexels.com/photos/2598719/pexels-photo-2598719.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  zurich: "https://images.pexels.com/photos/164466/pexels-photo-164466.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  athens: "https://images.pexels.com/photos/772689/pexels-photo-772689.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  cairo: "https://images.pexels.com/photos/3214982/pexels-photo-3214982.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  istanbul: "https://images.pexels.com/photos/2763930/pexels-photo-2763930.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  moscow: "https://images.pexels.com/photos/236294/pexels-photo-236294.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  seoul: "https://images.pexels.com/photos/2121068/pexels-photo-2121068.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  beijing: "https://images.pexels.com/photos/2846076/pexels-photo-2846076.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  shanghai: "https://images.pexels.com/photos/683419/pexels-photo-683419.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",

  // Beach/Island destinations
  bali: "https://images.pexels.com/photos/2166559/pexels-photo-2166559.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  maldives: "https://images.pexels.com/photos/1483053/pexels-photo-1483053.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  hawaii: "https://images.pexels.com/photos/1268855/pexels-photo-1268855.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  santorini: "https://images.pexels.com/photos/1010657/pexels-photo-1010657.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  phuket: "https://images.pexels.com/photos/1078983/pexels-photo-1078983.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  cancun: "https://images.pexels.com/photos/994605/pexels-photo-994605.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",

  // Countries (for broader searches)
  italy: "https://images.pexels.com/photos/1701595/pexels-photo-1701595.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  france: "https://images.pexels.com/photos/2363/france-landmark-lights-night.jpg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  japan: "https://images.pexels.com/photos/590478/pexels-photo-590478.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  spain: "https://images.pexels.com/photos/819764/pexels-photo-819764.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  greece: "https://images.pexels.com/photos/1285625/pexels-photo-1285625.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  thailand: "https://images.pexels.com/photos/1659438/pexels-photo-1659438.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  indonesia: "https://images.pexels.com/photos/2474689/pexels-photo-2474689.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  australia: "https://images.pexels.com/photos/2193300/pexels-photo-2193300.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  germany: "https://images.pexels.com/photos/109629/pexels-photo-109629.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  portugal: "https://images.pexels.com/photos/1534560/pexels-photo-1534560.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",

  // US Cities
  "los angeles": "https://images.pexels.com/photos/2695679/pexels-photo-2695679.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  "san francisco": "https://images.pexels.com/photos/208745/pexels-photo-208745.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  chicago: "https://images.pexels.com/photos/1823681/pexels-photo-1823681.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  miami: "https://images.pexels.com/photos/421927/pexels-photo-421927.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  "las vegas": "https://images.pexels.com/photos/415999/pexels-photo-415999.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  boston: "https://images.pexels.com/photos/1837591/pexels-photo-1837591.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  seattle: "https://images.pexels.com/photos/1486785/pexels-photo-1486785.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  washington: "https://images.pexels.com/photos/1527934/pexels-photo-1527934.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",

  // European cities
  budapest: "https://images.pexels.com/photos/351283/pexels-photo-351283.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  copenhagen: "https://images.pexels.com/photos/416024/pexels-photo-416024.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  stockholm: "https://images.pexels.com/photos/2376713/pexels-photo-2376713.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  oslo: "https://images.pexels.com/photos/1559825/pexels-photo-1559825.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  helsinki: "https://images.pexels.com/photos/1538367/pexels-photo-1538367.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  dublin: "https://images.pexels.com/photos/2416653/pexels-photo-2416653.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  edinburgh: "https://images.pexels.com/photos/803512/pexels-photo-803512.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  brussels: "https://images.pexels.com/photos/1595085/pexels-photo-1595085.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",

  // Italian cities
  naples: "https://images.pexels.com/photos/4819547/pexels-photo-4819547.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  amalfi: "https://images.pexels.com/photos/4388167/pexels-photo-4388167.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  trieste: "https://images.pexels.com/photos/5007066/pexels-photo-5007066.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",

  // Asian cities
  kyoto: "https://images.pexels.com/photos/1440476/pexels-photo-1440476.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  osaka: "https://images.pexels.com/photos/2506923/pexels-photo-2506923.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  hanoi: "https://images.pexels.com/photos/2835436/pexels-photo-2835436.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  "ho chi minh": "https://images.pexels.com/photos/3019797/pexels-photo-3019797.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  taipei: "https://images.pexels.com/photos/2374939/pexels-photo-2374939.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  mumbai: "https://images.pexels.com/photos/2104152/pexels-photo-2104152.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  delhi: "https://images.pexels.com/photos/789750/pexels-photo-789750.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",

  // South America
  "rio de janeiro": "https://images.pexels.com/photos/2868242/pexels-photo-2868242.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  "buenos aires": "https://images.pexels.com/photos/1060803/pexels-photo-1060803.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  lima: "https://images.pexels.com/photos/2929906/pexels-photo-2929906.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  "machu picchu": "https://images.pexels.com/photos/2356045/pexels-photo-2356045.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",

  // Africa
  marrakech: "https://images.pexels.com/photos/3889843/pexels-photo-3889843.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
  "cape town": "https://images.pexels.com/photos/259447/pexels-photo-259447.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop",
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
 * Find curated image for destination (fuzzy match)
 */
function findCuratedImage(destination: string): string | null {
  const normalized = normalizeDestination(destination);

  // Direct match
  if (CURATED_DESTINATIONS[normalized]) {
    return CURATED_DESTINATIONS[normalized];
  }

  // Partial match (destination contains key or key contains destination)
  for (const [key, url] of Object.entries(CURATED_DESTINATIONS)) {
    if (normalized.includes(key) || key.includes(normalized)) {
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
    console.warn("PEXELS_API_KEY not configured");
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
      console.error("Pexels API error:", response.status);
      return null;
    }

    const data = await response.json();

    if (data.photos && data.photos.length > 0) {
      // Get a random photo from top 5 for variety
      const randomIndex = Math.floor(Math.random() * Math.min(data.photos.length, 5));
      const photo = data.photos[randomIndex];

      // Use the "large" size for good quality without being too heavy
      return photo.src.large || photo.src.medium || photo.src.original;
    }

    return null;
  } catch (error) {
    console.error("Error fetching from Pexels:", error);
    return null;
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const destination = searchParams.get("destination");

  if (!destination) {
    return NextResponse.json(
      { error: "Destination parameter is required" },
      { status: 400 }
    );
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
    return NextResponse.json({
      url: cached.url,
      source: "cache",
      destination: cacheKey
    }, { headers: cacheHeaders });
  }

  // Try curated images first (fastest, most reliable)
  const curatedUrl = findCuratedImage(destination);
  if (curatedUrl) {
    imageCache.set(cacheKey, { url: curatedUrl, timestamp: Date.now() });
    return NextResponse.json({
      url: curatedUrl,
      source: "curated",
      destination: cacheKey
    }, { headers: cacheHeaders });
  }

  // Try Pexels API for uncurated destinations
  const pexelsUrl = await fetchFromPexels(destination);
  if (pexelsUrl) {
    imageCache.set(cacheKey, { url: pexelsUrl, timestamp: Date.now() });
    return NextResponse.json({
      url: pexelsUrl,
      source: "pexels",
      destination: cacheKey
    }, { headers: cacheHeaders });
  }

  // Fallback to generic travel image
  return NextResponse.json({
    url: FALLBACK_IMAGE,
    source: "fallback",
    destination: cacheKey
  }, { headers: cacheHeaders });
}

export async function POST(request: NextRequest) {
  try {
    const { destination } = await request.json();

    if (!destination) {
      return NextResponse.json(
        { error: "Destination is required" },
        { status: 400 }
      );
    }

    // Redirect to GET with destination as query param
    const url = new URL(request.url);
    url.searchParams.set("destination", destination);

    return GET(new NextRequest(url));
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }
}
