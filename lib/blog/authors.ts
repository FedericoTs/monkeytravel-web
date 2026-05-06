/**
 * Named author personas for the MonkeyTravel blog.
 *
 * Why this exists: Google's Helpful Content classifier weights named, bylined
 * authorship as a positive E-E-A-T signal. Posts authored by "Team" are
 * downweighted relative to ones with named authors who have a discoverable
 * presence on the site (bio page, photo, area of expertise). This module
 * is the single source of truth for who wrote what.
 *
 * To add a real photo: drop `/public/images/authors/{slug}.jpg` (square,
 * 400x400 minimum). The bio page auto-picks it up.
 */

export interface Author {
  /** URL slug (kebab-case). Used in /about/authors/{slug} */
  slug: string;
  /** Display name shown in bylines and bio page */
  name: string;
  /** Frontmatter `author:` value. Match exactly across the .md files. */
  frontmatterId: string;
  /** Short job title — appears under the name in the byline */
  title: string;
  /** 1-2 sentence summary for the byline tooltip / OG description */
  shortBio: string;
  /** Full bio rendered on the author page. Plain text; line breaks become <p>. */
  fullBio: string;
  /** Topics this author covers — used to drive automatic post→author mapping */
  expertise: string[];
  /** Number of countries the author has visited (for the bio sidebar) */
  countriesVisited: number;
  /** Languages the author writes in (used for ES/IT byline overrides) */
  languages: ReadonlyArray<"en" | "es" | "it">;
  /** Twitter/X handle without @, optional */
  twitter?: string;
  /** LinkedIn profile slug, optional */
  linkedin?: string;
}

export const AUTHORS: Author[] = [
  {
    slug: "federico-s",
    name: "Federico S.",
    frontmatterId: "Federico S.",
    title: "Founder & AI Travel Lead",
    shortBio: "Founder of MonkeyTravel. Italian-born, builds AI tools for travel planning and writes about Italy, Southern Europe, and the AI side of trip design.",
    fullBio: `Federico is the founder of MonkeyTravel. He grew up between Rome and Milan, then spent the last decade in product roles building consumer software in London, Berlin, and Lisbon. He started MonkeyTravel after watching too many friends spend entire Sunday afternoons tab-juggling between Booking.com, Google Maps, and Reddit threads — and getting to the airport with itineraries that fell apart by Day 2.

He writes mostly about Italy (which he knows well enough to be opinionated about), the AI tools reshaping how people plan trips, and the engineering tradeoffs that decide whether an AI itinerary is useful or hallucinated. He's been to most of Western Europe by train, half of Southeast Asia by motorbike, and no, he doesn't think AI will replace travel agents — he thinks it will replace the bad ones.`,
    expertise: ["italy", "ai-tools", "founder-strategy", "southern-europe", "product"],
    countriesVisited: 38,
    languages: ["en", "es", "it"],
    twitter: "monkeytravel",
  },
  {
    slug: "enrico-e",
    name: "Enrico E.",
    frontmatterId: "Enrico E.",
    title: "Asia & Pacific Editor",
    shortBio: "Asia specialist. Has lived in Tokyo, Bangkok, and Bali; covers East and Southeast Asia itineraries, food, and transit.",
    fullBio: `Enrico writes about Asia. He spent two years in Tokyo on a working-holiday visa, then six months teaching English in Chiang Rai before realizing he'd rather plan trips than grade them. He's now based loosely between Bali and Bangkok, depending on rainy season and where the cheaper flights are.

His specialty is the operational side of Asian travel — the kind of details that decide whether your day works: which BTS station to use for the airport, when to buy a JR Pass, why the Grab driver is faster than the metered taxi, what the dress code at a temple actually means. He travels with a laptop and a small camera, not a tour group, and his favorite city is whichever one he's eaten in most recently.`,
    expertise: ["asia", "japan", "thailand", "indonesia", "vietnam", "korea", "transit", "street-food"],
    countriesVisited: 27,
    languages: ["en"],
  },
  {
    slug: "francesca-a",
    name: "Francesca A.",
    frontmatterId: "Francesca A.",
    title: "Europe & Romance Editor",
    shortBio: "Europe and Mediterranean specialist. Covers city itineraries, honeymoon planning, wellness travel, and the kind of trip that requires a good restaurant reservation.",
    fullBio: `Francesca covers the European city itineraries, the romantic getaways, the wellness escapes — basically the trips where the goal isn't to see everything but to see the right thing properly. She's based in Lisbon, grew up in Florence, and has spent enough weekends in Paris and Rome that she could draw the Marais and Trastevere from memory.

She started in food writing — three years at a Lisbon culinary magazine — and that lens shows up in everything she writes. A 3-day Paris itinerary, in her hands, is mostly an argument about which bakery to start the morning at. She's planned weddings (twice for friends, once for herself), so the honeymoon coverage comes with strong opinions about what actually matters when two people are jet-lagged on Day 1.`,
    expertise: ["europe", "paris", "rome", "lisbon", "honeymoon", "wellness", "food", "romance"],
    countriesVisited: 32,
    languages: ["en", "es", "it"],
  },
  {
    slug: "giuseppe-g",
    name: "Giuseppe G.",
    frontmatterId: "Giuseppe G.",
    title: "Group Travel & Logistics Editor",
    shortBio: "Group travel and trip-logistics specialist. Has organized over 40 group trips and writes about the systems that keep them from falling apart.",
    fullBio: `Giuseppe is the person every friend group relies on to actually book the thing. He's organized over 40 group trips since 2018 — bachelorettes, family reunions, hiking groups, friends-of-friends weddings — and the recurring patterns of what works (and what blows up the group chat) became the basis for most of his coverage on this site.

His writing is the operational kind: how to split costs without resentment, how to set a budget BEFORE picking the destination, why the trip dictator wears out by Day 3, what to put in a packing list so nobody arrives without a power adapter. He's based in Naples, travels with a clipboard he claims is ironic, and takes a photo of every parking ticket so he can expense it back to the group.`,
    expertise: ["group-travel", "logistics", "planning", "checklists", "budgeting", "how-to", "visa"],
    countriesVisited: 24,
    languages: ["en", "es", "it"],
  },
  {
    slug: "riccardo-p",
    name: "Riccardo P.",
    frontmatterId: "Riccardo P.",
    title: "AI & Travel Tech Editor",
    shortBio: "AI travel-tech specialist. Tests AI itinerary tools against each other, writes the comparison reviews, and covers the tools-and-tech side of trip planning.",
    fullBio: `Riccardo covers the AI side of travel — which tools work, which ones hallucinate, what the difference is between asking ChatGPT to plan a trip and using software actually built for it. He has a software-engineering background (six years at travel-adjacent startups in Berlin and Amsterdam) and approaches AI itinerary tools the way you'd approach any other software: test it, break it, write down what failed.

His comparison reviews are based on identical test prompts run against multiple tools, with the same fact-check pass on every output. He's not anti-ChatGPT — he uses it daily — but he's clear-eyed about where it breaks down for trip planning. He travels mostly to test things: a tool that promises good Tokyo recommendations gets tested in Tokyo, not in his living room.`,
    expertise: ["ai-tools", "comparison", "travel-tech", "chatgpt", "tools-reviews", "policy", "etias", "visas"],
    countriesVisited: 21,
    languages: ["en", "es", "it"],
  },
  {
    slug: "emanuela-p",
    name: "Emanuela P.",
    frontmatterId: "Emanuela P.",
    title: "Seasonal & Cultural Travel Editor",
    shortBio: "Seasonal and cultural travel specialist. Covers when-to-go, festivals, natural phenomena, and the timing decisions that make or break a trip.",
    fullBio: `Emanuela writes about timing — which month, which season, which festival, which natural-phenomenon window. She has a background in cultural anthropology (master's from Bologna) and the academic instinct shows up in her coverage: she'll cite when cherry blossom forecasts are released by the Japanese Meteorological Corporation, why Iceland's midnight sun starts a week earlier in Akureyri than in Reykjavik, what the difference is between shoulder season pricing in May and shoulder season pricing in October.

She's spent the last five years chasing seasonal travel deliberately — northern lights in Tromsø in February, fall foliage in Vermont in October, monsoon in Kerala in June. Her coverage is the kind that helps you not waste a 7-day trip on the wrong week. She lives in Bologna and gets impatient with vague "best time to visit" advice that doesn't engage with the actual data.`,
    expertise: ["seasonal", "festivals", "natural-phenomena", "cultural-travel", "timing", "monthly-listicles", "northern-lights", "cherry-blossom"],
    countriesVisited: 31,
    languages: ["en", "es", "it"],
  },
];

const AUTHOR_BY_FRONTMATTER_ID = new Map(AUTHORS.map((a) => [a.frontmatterId, a]));
const AUTHOR_BY_SLUG = new Map(AUTHORS.map((a) => [a.slug, a]));

/** Look up an author by the value stored in a post's `author:` frontmatter. */
export function getAuthorByFrontmatterId(id: string | undefined | null): Author | null {
  if (!id) return null;
  return AUTHOR_BY_FRONTMATTER_ID.get(id) ?? null;
}

export function getAuthorBySlug(slug: string): Author | null {
  return AUTHOR_BY_SLUG.get(slug) ?? null;
}

export function getAllAuthors(): Author[] {
  return AUTHORS;
}

/**
 * Posts that don't have a recognized author fall back to the first author
 * (the founder). Used by the byline so a typo in frontmatter never produces
 * a blank author page.
 */
export function getDefaultAuthor(): Author {
  return AUTHORS[0];
}
