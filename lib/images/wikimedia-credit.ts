/**
 * Wikimedia Commons photos we store for destinations (lib/images/wikimedia.ts)
 * carry their credit in the URL: author, licence and Commons file name. Every
 * place that shows the photo (hero, trip card, share page) can then credit it
 * without a lookup, as the free licences require. Client-safe.
 */

export const WIKIMEDIA_IMAGE_PATH = "/api/images/wikimedia/";

export interface PhotoCredit {
  author: string;
  license: string;
  /** Commons file name, without "File:". */
  file: string;
}

/** The served path with its credit attached. */
export function withCredit(path: string, credit: PhotoCredit): string {
  const q = new URLSearchParams({ a: credit.author, l: credit.license, f: credit.file });
  return `${path}?${q.toString()}`;
}

/** The credit of a stored Wikimedia photo URL, or null for any other URL. */
export function readCredit(url: string | null | undefined): PhotoCredit | null {
  if (!url?.startsWith(WIKIMEDIA_IMAGE_PATH)) return null;
  const q = new URLSearchParams(url.split("?")[1] ?? "");
  const file = q.get("f");
  const license = q.get("l");
  return file && license ? { author: q.get("a") ?? "", license, file } : null;
}

/** The photo's page on Commons: author, licence and source in full. */
export function commonsPage(file: string): string {
  return `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file.replace(/ /g, "_"))}`;
}

const STORED_WIDTH = /-(\d+)\.jpg(?=\?|$)/;

/** The same stored photo at another of its stored widths. */
export function atStoredWidth(url: string, width: number): string {
  return url.replace(STORED_WIDTH, `-${width}.jpg`);
}

/** A stored cover at its 960px copy, for cards; any other URL unchanged. */
export function wikimediaCardSrc(url: string): string {
  if (!url.startsWith(WIKIMEDIA_IMAGE_PATH)) return url;
  return Number(STORED_WIDTH.exec(url)?.[1]) > 960 ? atStoredWidth(url, 960) : url;
}

/** A stored activity photo (500px, for cards) at its 960px copy, for the activity sheet; any other URL unchanged. */
export function wikimediaSheetSrc(url: string): string;
export function wikimediaSheetSrc(url: string | null | undefined): string | null | undefined;
export function wikimediaSheetSrc(url: string | null | undefined) {
  return url?.startsWith(WIKIMEDIA_IMAGE_PATH) && /-500\.jpg(\?|$)/.test(url) ? atStoredWidth(url, 960) : url;
}

/** A srcset for a stored cover, so phones get the 960px copy. Undefined for other URLs. */
export function wikimediaSrcSet(url: string | null | undefined): string | undefined {
  if (!url?.startsWith(WIKIMEDIA_IMAGE_PATH)) return undefined;
  const width = Number(STORED_WIDTH.exec(url)?.[1]);
  if (!(width > 960)) return undefined;
  return `${atStoredWidth(url, 960)} 960w, ${url} ${width}w`;
}
