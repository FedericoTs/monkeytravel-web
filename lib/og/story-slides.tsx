/**
 * The trip's story as pictures to post: the guess (the place hidden, its clues) and the answer (the place, its
 * dates, each day's shape). Story-sized, with what matters kept clear of the top and bottom strips an app lays
 * its own controls over. Drawn from the same story the share link tells (lib/story/trip-story.ts), in the same
 * colours, and with no photo: a photo from a map service may not leave the site.
 */
import type { ReactElement } from "react";
import { dayColor } from "@/lib/map/day-colors";
import { sketchDataUri, type Sketch } from "@/lib/og/route-sketch";
import type { TripStory } from "@/lib/story/trip-story";

export type SlideFormat = "guess" | "place";

export const SLIDE_SIZE = { width: 1080, height: 1920 };

export function slideFormat(raw: string | null | undefined): SlideFormat | null {
  return raw === "guess" || raw === "place" ? raw : null;
}

/** A slide's sentences, already in the reader's language (lib/story/words.ts builds them). */
export interface SlideWords {
  guessTitle: string;
  clues: { label: string; text: string }[];
  reply: string;
  dates: string | null;
  facts: string;
  planYours: string;
}

const NAVY = "#2D3436";
const FLAP = "#171B1C";
const GOLD = "#FFD93D";
const WHITE = "#FFFFFF";
const SOFT = "rgba(255,255,255,0.75)";
const DISPLAY = "Fraunces";
const BODY = "Source Sans 3";

// Kept clear at the top and the bottom: the posting app's own bars sit there.
const TOP = 250;
const BOTTOM = 330;
const SIDE = 80;
const INNER = SLIDE_SIZE.width - 2 * SIDE;

function Frame(p: { children: ReactElement | (ReactElement | null)[]; logo: string }): ReactElement {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: SLIDE_SIZE.width,
        height: SLIDE_SIZE.height,
        background: NAVY,
        color: WHITE,
        fontFamily: BODY,
        padding: `${TOP}px ${SIDE}px ${BOTTOM}px`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={p.logo} alt="" width={52} height={52} style={{ width: 52, height: 52, borderRadius: 12 }} />
        <div style={{ display: "flex", marginLeft: 16, fontWeight: 600, fontSize: 32, color: SOFT }}>MonkeyTravel</div>
      </div>
      {p.children}
    </div>
  );
}

/**
 * A line too long for the slide, cut in two at the space nearest its middle, so no last word is left alone
 * under the rest. `fits` is how many characters one line holds.
 */
export function balancedLines(text: string, fits: number): string[] {
  if (text.length <= fits) return [text];
  const middle = text.length / 2;
  let cut = -1;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === " " && (cut === -1 || Math.abs(i - middle) < Math.abs(cut - middle))) cut = i;
  }
  return cut === -1 ? [text] : [text.slice(0, cut), text.slice(cut + 1)];
}

function Centred(p: { children: string; size: number; top: number; color?: string; weight?: 400 | 600; display?: boolean; line?: number }): ReactElement {
  // The display face runs wider than the text face.
  const lines = balancedLines(p.children, Math.floor(INNER / (p.size * (p.display ? 0.52 : 0.46))));
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        width: INNER,
        marginTop: p.top,
        fontFamily: p.display ? DISPLAY : BODY,
        fontWeight: p.display ? 700 : (p.weight ?? 400),
        fontSize: p.size,
        lineHeight: p.line ?? 1.25,
        letterSpacing: p.display ? -1 : 0,
        color: p.color ?? WHITE,
      }}
    >
      {lines.map((line, i) => (
        <div key={i} style={{ display: "flex", justifyContent: "center", textAlign: "center" }}>
          {line}
        </div>
      ))}
    </div>
  );
}

/** A day's stops joined in order, in the day's colour, with its first stop ringed. */
export function dayShapeSvg(route: Sketch, tint: string): string {
  const dots = route.points
    .map((point, i) =>
      i === 0
        ? `<circle cx="${point.x}" cy="${point.y}" r="12" fill="${WHITE}" stroke="${tint}" stroke-width="7"/>`
        : `<circle cx="${point.x}" cy="${point.y}" r="8" fill="${tint}"/>`
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${route.width}" height="${route.height}" viewBox="0 0 ${route.width} ${route.height}"><path d="${route.path}" fill="none" stroke="${tint}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>${dots}</svg>`;
}

/** The whole trip's stops joined in order, each in its day's colour. */
export function tripRouteSvg(route: Sketch): string {
  const dots = route.points
    .map((point, i) => `<circle cx="${point.x}" cy="${point.y}" r="${i === 0 ? 7 : 5}" fill="${dayColor(point.day)}" stroke="${NAVY}" stroke-width="2"/>`)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${route.width}" height="${route.height}" viewBox="0 0 ${route.width} ${route.height}"><path d="${route.path}" fill="none" stroke="${WHITE}" stroke-opacity="0.5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>${dots}</svg>`;
}

function GuessSlide(p: { words: SlideWords; logo: string }): ReactElement {
  return (
    <Frame logo={p.logo}>
      <Centred size={92} top={64} display line={1.05}>
        {p.words.guessTitle}
      </Centred>
      <div style={{ display: "flex", justifyContent: "center", marginTop: 54, padding: 26, borderRadius: 32, background: "rgba(0,0,0,0.25)" }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 128,
              height: 170,
              marginLeft: i === 0 ? 0 : 14,
              borderRadius: 16,
              background: FLAP,
              color: GOLD,
              fontWeight: 600,
              fontSize: 104,
            }}
          >
            ?
          </div>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", marginTop: 26 }}>
        {p.words.clues.map((clue, i) => (
          <div
            key={i}
            style={{ display: "flex", flexDirection: "column", marginTop: 20, padding: "24px 34px", borderRadius: 26, background: "rgba(255,255,255,0.10)" }}
          >
            <div style={{ display: "flex", fontSize: 28, color: SOFT }}>{clue.label}</div>
            <div style={{ display: "flex", marginTop: 4, fontSize: 40, lineHeight: 1.25 }}>{clue.text}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", marginTop: "auto" }}>
        <Centred size={46} top={0} weight={600} color={GOLD}>
          {p.words.reply}
        </Centred>
      </div>
    </Frame>
  );
}

function placeSize(place: string): number {
  const longest = Math.max(...place.split(/\s+/).map((word) => word.length));
  if (place.length <= 7) return 210;
  if (place.length <= 10) return 168;
  if (place.length <= 16 && longest <= 10) return 132;
  return place.length <= 30 ? 96 : 72;
}

function DayShapes(p: { story: TripStory }): ReactElement | null {
  const drawn = p.story.days.filter((day) => day.route);
  if (drawn.length === 0) return null;
  // Up to four in a row; more are set in two rows of about the same length.
  const perRow = drawn.length <= 4 ? drawn.length : Math.ceil(drawn.length / 2);
  const rows = [drawn.slice(0, perRow), drawn.slice(perRow)].filter((row) => row.length > 0);
  const width = 200;
  const gap = 40;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: INNER, marginTop: 70 }}>
      {rows.map((row, r) => (
        <div key={r} style={{ display: "flex", justifyContent: "center", marginBottom: 28 }}>
          {row.map((day, i) => {
            const route = day.route as Sketch;
            const height = Math.round((route.height * width) / route.width);
            return (
              <div key={day.day} style={{ display: "flex", flexDirection: "column", alignItems: "center", width, marginLeft: i === 0 ? 0 : gap }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={sketchDataUri(dayShapeSvg(route, dayColor(day.day)))} alt="" width={width} height={height} style={{ width, height }} />
                <div style={{ display: "flex", marginTop: 6, fontWeight: 600, fontSize: 34, color: SOFT }}>{String(day.day)}</div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function TripRoute(p: { route: Sketch }): ReactElement {
  const scale = 620 / p.route.width;
  const width = Math.round(p.route.width * scale);
  const height = Math.round(p.route.height * scale);
  return (
    <div style={{ display: "flex", justifyContent: "center", width: INNER, marginTop: 60 }}>
      <div style={{ display: "flex", position: "relative", width, height }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={sketchDataUri(tripRouteSvg(p.route))} alt="" width={width} height={height} style={{ width, height }} />
        {p.route.labels.map((label) => {
          // Beside its dot: to the left of it on the right-hand side of the drawing.
          const leftward = label.x > p.route.width * 0.6;
          return (
            <div
              key={label.text}
              style={{
                display: "flex",
                position: "absolute",
                top: Math.round(label.y * scale) - 22,
                ...(leftward ? { right: Math.round((p.route.width - label.x) * scale) + 20 } : { left: Math.round(label.x * scale) + 20 }),
                fontWeight: 600,
                fontSize: 30,
                color: WHITE,
                background: "rgba(45,52,54,0.85)",
                borderRadius: 8,
                padding: "0 8px",
              }}
            >
              {label.text}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PlaceSlide(p: { story: TripStory; words: SlideWords; logo: string }): ReactElement {
  const severalCities = p.story.cities.length > 1;
  return (
    <Frame logo={p.logo}>
      <Centred size={placeSize(p.story.place)} top={110} display line={1.02}>
        {p.story.place}
      </Centred>
      {p.words.dates ? (
        <Centred size={44} top={30} color={SOFT}>
          {p.words.dates}
        </Centred>
      ) : null}
      {severalCities && p.story.route ? <TripRoute route={p.story.route} /> : <DayShapes story={p.story} />}
      <Centred size={46} top={44} line={1.3}>
        {p.words.facts}
      </Centred>
      <div style={{ display: "flex", flexDirection: "column", marginTop: "auto" }}>
        <Centred size={36} top={0} color={SOFT}>
          {p.words.planYours}
        </Centred>
      </div>
    </Frame>
  );
}

/** The picture for `format`. A story with no guess has only its place to show. */
export function renderStorySlide(format: SlideFormat, story: TripStory, words: SlideWords, logo: string): ReactElement {
  return format === "guess" && story.guess ? <GuessSlide words={words} logo={logo} /> : <PlaceSlide story={story} words={words} logo={logo} />;
}
