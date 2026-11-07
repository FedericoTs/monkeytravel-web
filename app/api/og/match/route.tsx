import { ImageResponse } from "next/og";
import { after, type NextRequest } from "next/server";
import type { ReactElement } from "react";
import { logFunnelEventServer } from "@/lib/analytics/funnel-events";
import { previewClient } from "@/lib/analytics/preview-client";
import { writesTelemetry } from "@/lib/analytics/telemetry-env";
import type { Locale } from "@/lib/destinations/types";
import { PLACE_PHOTOS, START_PHOTOS, photoUrl } from "@/lib/match/photos";
import { MATCH_PLACES, matchDestination } from "@/lib/match/places";
import { parseCode, parseCompanions, type Person } from "@/lib/match/questions";
import { rankPlaces, travelType } from "@/lib/match/score";
import { cardFonts } from "@/lib/og/fonts";
import { linkCardJpeg, shareCardJpeg } from "@/lib/og/link-card-jpeg";
import { renderMatchCard, renderMatchInvite } from "@/lib/og/match-card";
import { CARD_SIZES, cardFormat, cardLocale, type CardFormat } from "@/lib/og/trip-card";
import { SITE_URL } from "@/lib/seo/canonical";

/**
 * A match result as an image: the link preview (the default), a square and a
 * story. It takes the answers' code and nothing else, so it can only ever draw a
 * real result, never someone's text on a MonkeyTravel card. The answers decide
 * the picture completely, so the CDN can keep each one for a long time.
 */
export const runtime = "nodejs";

const CACHE = "public, max-age=86400, s-maxage=2592000, stale-while-revalidate=604800";
const CACHE_WITHOUT_PHOTO = "public, max-age=300";
const IMAGE_TIMEOUT_MS = 5000;

/** An image as data, or nothing: a card still goes out without it. */
async function loadImage(src: string): Promise<string | null> {
  try {
    const response = await fetch(src, { signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS) });
    if (!response.ok) return null;
    const type = response.headers.get("content-type") ?? "image/jpeg";
    return `data:${type};base64,${Buffer.from(await response.arrayBuffer()).toString("base64")}`;
  } catch {
    return null;
  }
}

async function loadImages(photoId: number, format: CardFormat) {
  const { width, height } = CARD_SIZES[format];
  const [cover, logo] = await Promise.all([loadImage(photoUrl(photoId, width, height)), loadImage(`${SITE_URL}/icon-512.png`)]);
  return { cover, logo };
}

async function respond(element: ReactElement, format: CardFormat, hasPhoto: boolean): Promise<Response> {
  const fonts = await cardFonts();
  const png = await new ImageResponse(element, { ...CARD_SIZES[format], ...(fonts.length > 0 ? { fonts } : {}) }).arrayBuffer();
  // JPEG in every size: a photo is far smaller that way. Only the link preview has a limit to meet.
  const jpeg = format === "og" ? await linkCardJpeg(png) : await shareCardJpeg(png);
  // A card missing its photo isn't kept for long, so the next one can have it.
  return new Response(new Uint8Array(jpeg), { headers: { "Cache-Control": hasPhoto ? CACHE : CACHE_WITHOUT_PHOTO, "Content-Type": "image/jpeg" } });
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const format = cardFormat(url.searchParams.get("format"));
  const locale = cardLocale(url.searchParams.get("locale"));
  const code = url.searchParams.get("c");
  const me = parseCode(code);
  const copy = (await import(`@/messages/${locale}/match.json`)).default;

  if (!me || !code) {
    const images = await loadImages(START_PHOTOS[0], format);
    return respond(renderMatchInvite({ ...images, title: copy.start.title, subtitle: copy.start.subtitle }, format), format, images.cover !== null);
  }

  const friends = parseCompanions(url.searchParams.get("with"), code);
  const people: Person[] = [me, ...friends.map((friend) => parseCode(friend) as Person)];
  const best = rankPlaces(MATCH_PLACES, people)[0];
  const destination = matchDestination(best.place.slug);
  const together = people.length > 1;
  const typeName: string = copy.types[travelType(me)].name;

  const sessionId = request.cookies.get("mt_session_id")?.value ?? null;
  if (writesTelemetry(sessionId)) {
    const metadata = { kind: "match", format, locale, client: previewClient(request.headers.get("user-agent")) };
    after(() => logFunnelEventServer({ event_type: "trip_card_rendered", session_id: sessionId, metadata }));
  }

  const images = await loadImages(PLACE_PHOTOS[best.place.slug].id, format);
  return respond(
    renderMatchCard(
      {
        ...images,
        overline: together ? copy.result.cardTogether : typeName,
        place: destination.name[locale as Locale],
        country: destination.country[locale as Locale],
        percent: copy.result.percent.replace("{percent}", String(best.percent)),
        people: together ? copy.result.cardPeople.replace("{count}", String(people.length)) : undefined,
        invite: copy.result.cardInvite,
      },
      format
    ),
    format,
    images.cover !== null
  );
}
