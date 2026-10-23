import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { WIKIMEDIA_IMAGE_PATH, withCredit } from "@/lib/images/wikimedia-credit";

/**
 * Destination photos from Wikimedia Commons, whose free licences allow keeping
 * a credited copy (Google's terms forbid storing Places photos). The cover is
 * the place's Wikidata image, else its Wikipedia lead image; the gallery comes
 * from the See, Do and Understand sections of its Wikivoyage article.
 */

const UA = "MonkeyTravel/1.0 (https://monkeytravel.app; support@monkeytravel.app)";
const WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php";
export const WIKIDATA_API = "https://www.wikidata.org/w/api.php";
const WIKIVOYAGE_API = "https://en.wikivoyage.org/w/api.php";
const COMMONS_API = "https://commons.wikimedia.org/w/api.php";

export const DESTINATION_IMAGES_BUCKET = "destination-images";
const GALLERY_SIZE = 4;
const MAX_CANDIDATES = 30;

const FREE_LICENSE = /^(cc0|public domain|pd\b|cc by(-sa)? \d(\.\d)?\b)/i;
// Not a view of the place: maps, flags and emblems, or a transport hub.
const NOT_A_VIEW =
  /\b(maps?|flags?|logos?|icons?|seals?|coat of arms|emblems?|locator|banners?|diagrams?|charts?|plans?|airport|aeroporto|aeropuerto|aéroport|flughafen|bus (station|terminal|stop)|buseta)\b/i;
// Wikivoyage sections where travel editors put the sights. "Nearby popular
// Wikipedia articles" was tried instead and surfaced crimes and disasters.
const TRAVEL_SECTION = /^(see|do|understand|districts)\b/i;

export interface CommonsFile {
  /** Commons file name, without "File:". */
  name: string;
  /** Thumbnail URL at a standard Commons width (1280px unless asked). */
  thumb: string;
  width: number;
  height: number;
  mime: string;
  license: string;
  artist: string;
  restrictions: string;
}

export interface DestinationPhotos {
  /** Served cover URL, credit attached, at its largest stored width. */
  cover: string;
  /** Served gallery thumbnails, credit attached. */
  gallery: string[];
}

const sameName = (a: string, b: string) => a.replace(/_/g, " ").toLowerCase() === b.replace(/_/g, " ").toLowerCase();

/**
 * Big enough (a hero by default), landscape, a JPEG photo, under a free
 * licence; under an attribution licence (CC BY, CC BY-SA), with an author we
 * can name.
 */
export function isUsablePhoto(f: CommonsFile, minWidth = 1280): boolean {
  return (
    f.mime === "image/jpeg" &&
    f.width >= minWidth &&
    f.width / f.height >= 1.2 &&
    FREE_LICENSE.test(f.license.trim()) &&
    (f.artist !== "" || !/^cc by/i.test(f.license.trim())) &&
    !/trademark/i.test(f.restrictions) &&
    !NOT_A_VIEW.test(f.name.replace(/_/g, " "))
  );
}

/** File names in a Wikivoyage article's travel sections, in order, without repeats. */
export function travelSectionImages(wikitext: string): string[] {
  const names: string[] = [];
  let section = "";
  for (const line of wikitext.split("\n")) {
    const heading = /^==\s*([^=].*?)\s*==\s*$/.exec(line);
    if (heading) {
      section = heading[1];
      continue;
    }
    if (!TRAVEL_SECTION.test(section)) continue;
    for (const m of line.matchAll(/\[\[(?:File|Image):([^|\]]+)/gi)) names.push(m[1]);
    for (const m of line.matchAll(/\|\s*image\s*=\s*([^|}\n]+)/gi)) names.push(m[1]);
  }
  const seen = new Set<string>();
  return names
    .map((n) => n.trim().replace(/^(File|Image):/i, ""))
    .filter((n) => {
      const key = n.replace(/_/g, " ").toLowerCase();
      if (!n || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** A link that leads somewhere instead of naming anyone: "(talk)", "[2]", "Flickr", a bare URL. */
function isNotAName(linkText: string): boolean {
  const text = linkText.replace(/<[^>]*>/g, "").trim().replace(/^\((.*)\)$/, "$1").trim();
  return (
    /^(?:uploads|contribs|contributions|more photos|(?:photo )?portfolio|flickr|website|homepage|\[\d+\]|(?:https?:\/\/|www\.)\S*)$/i.test(text) ||
    text.split("/").some((word) => /^talk$/i.test(word.trim()))
  );
}

// What Commons puts around a name, peeled off until nothing changes: "Photo
// by …", "The original uploader was … at English Wikipedia", "User:…",
// "File:x.jpg: …", "(cs:…)", a signature's date, a URL, the rest of a sentence.
const AROUND_A_NAME: [RegExp, string][] = [
  [/^\(([^()]*)\)$/, "$1"],
  [
    /^(?:(?:this|the) (?:photo|photograph|image|picture|file|work)\b[^.]*?\bby\s+|(?:[\p{L}.]+ ){0,3}(?:photo|photograph|image|img|picture) by\s+|by\s+|(?:the )?original uploader was\s+|original(?: work)?:\s*|source:\s*|flickr user:\s*|(?:\p{L}+ )?wikipedia user\s+|(?:[a-z-]{1,3}:){0,2}user(?::\s*|\s+)|\(WT-[a-z]+\)\s*|(?:file:)?[^:]*?\.(?:jpe?g|png|svg|gif|tiff?)\s*:\s*)/iu,
    "",
  ],
  [/\s+(?:at|on) (?:the )?(?:\p{L}+ )?(?:[a-z-]{2,12}[.:])?(?:wikipedia|wikivoyage|commons)\b.*$/iu, ""],
  [/\s+(?:-\s+)?(?:user:|derivative(?: work)?:).*$/i, ""],
  [/\s*\((?:[a-z-]{2,3}:[^()]*|attribution required|own work)\)/gi, ""],
  [/\((?:[a-z]{1,3}:)?user:\s*/gi, "("],
  [/\s*\d{1,2}:\d{2}, \d{1,2}\.? [\p{L}.]+ \d{4} \([A-Z]{2,5}\)/u, ""],
  [/[,;]?\s*(?:https?:\/\/|www\.)\S+|\s*\[\d+\]/gi, ""],
  // "X. Feel free to use my photos…", but not the initials in "A. B. X".
  [/(?<!(?:^|\P{L})\p{Lu})\.\s+(?=\p{Lu}\p{Ll}+\s+\p{Ll}).*$/u, ""],
  [/(?<!(?:^|\P{L})\p{Lu}|\b(?:Jr|Sr|Inc|Ltd|Co))\.$|[\s,;:/–—-]+$/u, ""],
];

/** The user name in a field that is only a link to a profile: a wiki user page or a Flickr page. */
function profileName(html: string): string {
  const user = /\/wiki\/(?:[a-z-]+:)?user:([^"'?#<>\s/]+)/i.exec(html)?.[1];
  if (user) {
    try {
      return decodeURIComponent(user).replace(/_/g, " ");
    } catch {
      return user.replace(/_/g, " ");
    }
  }
  const flickr = /flickr\.com\/(?:photos|people)\/([\w.-]+)\/?["'<\s]/i.exec(html)?.[1];
  return flickr && !/^\d+$/.test(flickr) ? flickr : "";
}

/**
 * Commons' Artist field (HTML) as the author's name, or "" when it names
 * nobody. The field often wraps the name in more ("Photo by X (talk) at
 * English Wikipedia", Flickr's "X from Paris, France"), or is a whole note
 * ("This photo was taken by X. Feel free to use my photos…"); the name is
 * taken out of it.
 */
export function plainArtist(html: string): string {
  const lines = html
    .replace(/<a\b[^>]*>((?:(?!<\/a>)[\s\S])*)<\/a>/gi, (link, text: string) => (isNotAName(text) ? "" : link))
    .replace(/<br\s*\/?>|<\/(?:p|li|div|tr|td|th|dd|dt|h\d)>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, "&")
    .split("\n")
    .map((line) =>
      line
        .replace(/\s+/g, " ")
        .replace(/\s+([,;:.!?)\]])/g, "$1")
        .replace(/([(\[])\s+/g, "$1")
        .replace(/\s*\([\s·•|,;:/–—-]*\)/g, "")
        .trim(),
    );
  const first = lines.find((line) => /[\p{L}\p{N}]/u.test(line)) ?? "";
  if (/^(unknown|no machine-readable)/i.test(first)) return "";
  const flickr = /flickr\.com\//i.test(html);
  let name = first;
  for (let before = ""; name !== before; ) {
    before = name;
    for (const [pattern, replacement] of AROUND_A_NAME) name = name.replace(pattern, replacement).trim();
    if (flickr) name = name.replace(/^(.+?) from \S.*$/, "$1");
  }
  if (/\buser:/i.test(first)) name = name.replace(/_/g, " ");
  if (!name) return profileName(html);
  if (name.length <= 60) return name;
  const named = /\bby\s+((?:\p{Lu}[\p{L}'’-]*\.?\s+){0,3}\p{Lu}[\p{L}'’-]+)/u.exec(first);
  return named ? named[1] : "";
}

/** The Commons thumbnail URL at another standard width. */
export function thumbAt(thumb: string, width: number): string {
  return thumb.replace(/\/\d+px-([^/]+)$/, `/${width}px-$1`);
}

/** What to search for: the whole destination, then its first place ("Tokyo, Kyoto & Hiroshima"). */
export function searchQueries(destination: string): string[] {
  const whole = destination.replace(/\s+/g, " ").trim();
  const first = whole.split(/[,&;/]| and /)[0].trim();
  return [...new Set([whole, first].filter(Boolean))];
}

/** The cover (a Wikidata or lead image when usable) and up to four gallery photos. */
export function pickImages(
  files: CommonsFile[],
  isCoverCandidate: (f: CommonsFile) => boolean,
): { cover: CommonsFile; gallery: CommonsFile[] } | null {
  const usable = files.filter(isUsablePhoto);
  const cover = usable.find(isCoverCandidate) ?? usable[0];
  if (!cover) return null;
  return { cover, gallery: usable.filter((f) => f !== cover).slice(0, GALLERY_SIZE) };
}

export async function wiki(base: string, params: Record<string, string | number>, signal: AbortSignal): Promise<unknown> {
  const query = new URLSearchParams({ format: "json", formatversion: "2" });
  for (const [k, v] of Object.entries(params)) query.set(k, String(v));
  const res = await fetch(`${base}?${query.toString()}`, { headers: { "User-Agent": UA }, signal });
  if (!res.ok) throw new Error(`${new URL(base).hostname} answered ${res.status}`);
  return res.json();
}

interface SearchPage {
  title: string;
  index?: number;
  pageprops?: { wikibase_item?: string };
  coordinates?: unknown[];
  pageimage?: string;
}

/** The Wikipedia article (with coordinates, so a place) the destination names. */
async function findPlace(destination: string, signal: AbortSignal) {
  for (const q of searchQueries(destination)) {
    const d = (await wiki(
      WIKIPEDIA_API,
      { action: "query", generator: "search", gsrsearch: q, gsrlimit: 5, prop: "pageprops|coordinates|pageimages", ppprop: "wikibase_item", piprop: "name", pilicense: "free" },
      signal,
    )) as { query?: { pages?: SearchPage[] } };
    const pages = [...(d.query?.pages ?? [])].sort((a, b) => (a.index ?? 99) - (b.index ?? 99));
    const hit = pages.find((p) => p.pageprops?.wikibase_item && p.coordinates?.length);
    if (hit?.pageprops?.wikibase_item) return { qid: hit.pageprops.wikibase_item, lead: hit.pageimage };
  }
  return null;
}

interface Entity {
  claims?: { P18?: { mainsnak?: { datavalue?: { value?: unknown } } }[] };
  sitelinks?: { enwikivoyage?: { title?: string } };
}

interface ImagePage {
  title: string;
  imageinfo?: { thumburl?: string; width?: number; height?: number; mime?: string; extmetadata?: Record<string, { value?: string }> }[];
}

/**
 * Commons details of the named files, in the order given; missing files are
 * left out. `thumb` is at `width`, which must not exceed the stored widths.
 */
export async function commonsFiles(names: string[], signal: AbortSignal, width = 1280): Promise<CommonsFile[]> {
  if (names.length === 0) return [];
  const d = (await wiki(
    COMMONS_API,
    {
      action: "query",
      titles: names.map((n) => `File:${n}`).join("|"),
      prop: "imageinfo",
      iiprop: "url|size|mime|extmetadata",
      iiurlwidth: width,
      iiextmetadatafilter: "LicenseShortName|Artist|Restrictions",
    },
    signal,
  )) as { query?: { pages?: ImagePage[] } };
  const pages = d.query?.pages ?? [];
  return names.flatMap((n) => {
    const page = pages.find((p) => sameName(p.title, `File:${n}`));
    const info = page?.imageinfo?.[0];
    if (!page || !info?.thumburl) return [];
    const meta = info.extmetadata ?? {};
    return [
      {
        name: page.title.replace(/^File:/, ""),
        thumb: info.thumburl,
        width: info.width ?? 0,
        height: info.height || 1,
        mime: info.mime ?? "",
        license: meta.LicenseShortName?.value ?? "",
        artist: plainArtist(meta.Artist?.value ?? ""),
        restrictions: meta.Restrictions?.value ?? "",
      },
    ];
  });
}

/** The destination's cover and gallery on Commons, or null when it has no usable photo. */
export async function findDestinationPhotos(destination: string, signal: AbortSignal) {
  const place = await findPlace(destination, signal);
  if (!place) return null;
  const entity = (
    (await wiki(WIKIDATA_API, { action: "wbgetentities", ids: place.qid, props: "claims|sitelinks", sitefilter: "enwikivoyage" }, signal)) as {
      entities?: Record<string, Entity>;
    }
  ).entities?.[place.qid];
  const image = entity?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
  const voyage = entity?.sitelinks?.enwikivoyage?.title;
  const wikitext = voyage
    ? ((await wiki(WIKIVOYAGE_API, { action: "parse", page: voyage, prop: "wikitext", redirects: 1 }, signal)) as { parse?: { wikitext?: string } }).parse
        ?.wikitext ?? ""
    : "";
  const coverNames = [typeof image === "string" ? image : "", place.lead ?? ""].filter(Boolean);
  const names: string[] = [];
  for (const n of [...coverNames, ...travelSectionImages(wikitext)]) {
    if (!names.some((m) => sameName(m, n))) names.push(n);
  }
  const files = await commonsFiles(names.slice(0, MAX_CANDIDATES), signal);
  return pickImages(files, (f) => coverNames.some((c) => sameName(c, f.name)));
}

/** Stores the photo at the given widths, once per Commons file; returns each served URL. */
export async function storePhoto(db: SupabaseClient, f: CommonsFile, widths: number[], signal: AbortSignal): Promise<string[]> {
  const id = createHash("sha1").update(f.name.replace(/ /g, "_")).digest("hex").slice(0, 20);
  const credit = { author: f.artist, license: f.license.trim(), file: f.name };
  return Promise.all(
    widths.map(async (w) => {
      const res = await fetch(thumbAt(f.thumb, w), { headers: { "User-Agent": UA }, signal });
      if (!res.ok) throw new Error(`Commons thumbnail answered ${res.status}`);
      const file = `${id}-${w}.jpg`;
      const { error } = await db.storage
        .from(DESTINATION_IMAGES_BUCKET)
        .upload(`wikimedia/${file}`, await res.arrayBuffer(), { contentType: "image/jpeg", cacheControl: "31536000", upsert: true });
      if (error) throw new Error(`storage: ${error.message}`);
      return withCredit(`${WIKIMEDIA_IMAGE_PATH}${file}`, credit);
    }),
  );
}

/** Finds and stores the destination's photos; null when Commons has no usable one. */
export async function buildDestinationPhotos(db: SupabaseClient, destination: string, signal: AbortSignal): Promise<DestinationPhotos | null> {
  const picked = await findDestinationPhotos(destination, signal);
  if (!picked) return null;
  const coverUrls = await storePhoto(db, picked.cover, picked.cover.width >= 1920 ? [960, 1920] : [960, 1280], signal);
  // A gallery photo that fails to store is left out; the cover is what matters.
  const gallery = await Promise.all(picked.gallery.map((g) => storePhoto(db, g, [330], signal).catch(() => null)));
  return { cover: coverUrls[coverUrls.length - 1], gallery: gallery.flatMap((urls) => (urls ? [urls[0]] : [])) };
}
