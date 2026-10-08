/**
 * The trip card: one picture of a trip, in three sizes.
 *
 *   og      1200x630   link previews (the shared, public and invite pages)
 *   square  1080x1080  feeds
 *   story   1080x1920  stories and chats
 *
 * app/api/og/trip renders it through next/og (satori). That is why every box
 * with more than one child says display:flex, why text is clipped here and
 * not by CSS, and why the route sketch is a data-URI SVG image.
 */
import type { ReactElement } from "react";
import { dayColor } from "@/lib/map/day-colors";
import { routeSketch, sketchDataUri, sketchSvg, type Sketch } from "@/lib/og/route-sketch";

export type CardFormat = "og" | "square" | "story";
export type CardLocale = "en" | "es" | "it" | "pt";

export const CARD_SIZES: Record<CardFormat, { width: number; height: number }> = {
  og: { width: 1200, height: 630 },
  square: { width: 1080, height: 1080 },
  story: { width: 1080, height: 1920 },
};

export function cardFormat(raw: string | null | undefined): CardFormat {
  return raw === "square" || raw === "story" ? raw : "og";
}

export function cardLocale(raw: string | null | undefined): CardLocale {
  const l = (raw || "en").slice(0, 2).toLowerCase();
  return l === "es" || l === "it" || l === "pt" ? l : "en";
}

const DATE_LOCALE: Record<CardLocale, string> = { en: "en-GB", es: "es-ES", it: "it-IT", pt: "pt-BR" };

// Outside next-intl (this is an API route), so the few words live here.
const COPY = {
  en: {
    day: (n: number) => `Day ${n}`,
    dayOf: (k: number, n: number) => `Day ${k} of ${n}`,
    today: "Today",
    going: (n: number) => `${n} going`,
    days: (n: number) => (n === 1 ? "1 day" : `${n} days`),
    activities: (n: number) => `${n} activities`,
    more: (n: number) => `+${n} more days`,
    tagline: "Planned on MonkeyTravel",
  },
  es: {
    day: (n: number) => `Día ${n}`,
    dayOf: (k: number, n: number) => `Día ${k} de ${n}`,
    today: "Hoy",
    going: (n: number) => (n === 1 ? "1 va" : `${n} van`),
    days: (n: number) => (n === 1 ? "1 día" : `${n} días`),
    activities: (n: number) => `${n} actividades`,
    more: (n: number) => `+${n} días más`,
    tagline: "Planificado en MonkeyTravel",
  },
  it: {
    day: (n: number) => `Giorno ${n}`,
    dayOf: (k: number, n: number) => `Giorno ${k} di ${n}`,
    today: "Oggi",
    going: (n: number) => (n === 1 ? "1 viene" : `${n} vengono`),
    days: (n: number) => (n === 1 ? "1 giorno" : `${n} giorni`),
    activities: (n: number) => `${n} attività`,
    more: (n: number) => `+${n} altri giorni`,
    tagline: "Pianificato su MonkeyTravel",
  },
  pt: {
    day: (n: number) => `Dia ${n}`,
    dayOf: (k: number, n: number) => `Dia ${k} de ${n}`,
    today: "Hoje",
    going: (n: number) => (n === 1 ? "1 vai" : `${n} vão`),
    days: (n: number) => (n === 1 ? "1 dia" : `${n} dias`),
    activities: (n: number) => `${n} atividades`,
    more: (n: number) => `+${n} dias a mais`,
    tagline: "Planejado no MonkeyTravel",
  },
} as const;

export function cardCopy(locale: CardLocale) {
  return COPY[locale];
}

// Brand tokens (app/globals.css). Coral stays decorative: chips and pills,
// never small text on paper.
const NAVY = "#2D3436";
const DEEP = "#1C2326";
const PAPER = "#FFFAF5";
const MUTED = "#636E72";
const CORAL = "#FF6B6B";
const WHITE = "#FFFFFF";
const FOG = "#D9DEE2";
const DISPLAY = "Fraunces";
const BODY = "Source Sans 3";

function utcDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatRange(start: string | null | undefined, end: string | null | undefined, locale: CardLocale): string | null {
  const s = utcDate(start);
  if (!s) return null;
  const fmt = new Intl.DateTimeFormat(DATE_LOCALE[locale], { day: "numeric", month: "short", timeZone: "UTC" });
  const e = utcDate(end);
  if (!e) return `${fmt.format(s)} ${s.getUTCFullYear()}`;
  return `${fmt.format(s)} – ${fmt.format(e)} ${e.getUTCFullYear()}`;
}

export function formatDay(iso: string | null | undefined, locale: CardLocale): string | null {
  const d = utcDate(iso);
  if (!d) return null;
  return new Intl.DateTimeFormat(DATE_LOCALE[locale], { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(d);
}

/** Satori neither shrinks nor ellipsizes reliably, so lines are cut here, at a word when one is near. */
export function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const at = cut.lastIndexOf(" ");
  const kept = (at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s·,;:&–-]+$/u, "");
  return `${kept}…`;
}

export interface CardDay {
  day_number: number;
  date?: string | null;
  title?: string | null;
  theme?: string | null;
  city?: string | null;
  activities: { name?: string | null; coordinates?: { lat?: unknown; lng?: unknown } | null }[];
}

export interface DayLine {
  day: number;
  date: string | null;
  text: string;
}

/** The days in miniature: one line each, activity names joined, the rest counted. */
export function dayLines(days: CardDay[], locale: CardLocale, max: number, maxChars: number): { rows: DayLine[]; more: number } {
  const sorted = [...days].filter((d) => Number.isFinite(d.day_number)).sort((a, b) => a.day_number - b.day_number);
  const shown = sorted.length > max ? Math.max(1, max - 1) : sorted.length;
  const rows = sorted.slice(0, shown).map((d) => {
    const names = (d.activities ?? []).map((a) => (typeof a?.name === "string" ? a.name.trim() : "")).filter(Boolean);
    const text = names.length ? names.join(" · ") : (d.title || d.theme || "").trim();
    return { day: d.day_number, date: formatDay(d.date, locale), text: clip(text, maxChars) };
  });
  return { rows, more: sorted.length - rows.length };
}

/** The cover at a size the card can use. Pexels and the Places proxy take a size; anything else is left alone. */
export function coverForCard(url: string | null | undefined, origin: string, size = 1200): string | null {
  if (!url) return null;
  let abs: URL;
  try {
    abs = new URL(url, origin);
  } catch {
    return null;
  }
  if (abs.hostname === "images.pexels.com") {
    abs.searchParams.set("w", String(size));
    abs.searchParams.set("h", String(size));
    abs.searchParams.set("fit", "crop");
  } else if (abs.pathname === "/api/places/photo") {
    abs.searchParams.set("w", String(size));
    abs.searchParams.set("h", String(size));
    // The card renderer's fetch sends a library user-agent; og=1 keeps the
    // proxy from treating it as automation (app/api/places/photo/route.ts).
    abs.searchParams.set("og", "1");
  }
  return abs.toString();
}

export interface TripCardData {
  locale: CardLocale;
  destination: string;
  dates: string | null;
  days: CardDay[];
  /** Absolute, already sized (coverForCard). */
  cover: string | null;
  /** Absolute URL of the brand mark. */
  logo: string;
  goingCount: number;
  activityCount: number;
  nights: number | null;
  budget: string | null;
  live: { dayNumber: number; totalDays: number; today: string | null } | null;
}

type Pill = { text: string; accent: boolean };

function pills(d: TripCardData): Pill[] {
  const c = COPY[d.locale];
  const out: Pill[] = [];
  if (d.goingCount > 0) out.push({ text: c.going(d.goingCount), accent: true });
  if (d.days.length > 0) out.push({ text: d.nights !== null ? `${d.days.length}D · ${d.nights}N` : c.days(d.days.length), accent: false });
  if (d.activityCount > 0) out.push({ text: c.activities(d.activityCount), accent: false });
  if (d.budget) out.push({ text: d.budget, accent: false });
  return out;
}

function liveLine(d: TripCardData): string | null {
  if (!d.live) return null;
  const c = COPY[d.locale];
  const today = d.live.today ? ` · ${c.today}: ${clip(d.live.today, 34)}` : "";
  return `${c.dayOf(d.live.dayNumber, d.live.totalDays)}${today}`;
}

function displaySize(text: string, big: number, mid: number, small: number): number {
  return text.length <= 14 ? big : text.length <= 24 ? mid : small;
}

function Brand(p: { logo: string; size: number; fontSize: number; color: string; live: boolean }): ReactElement {
  return (
    <div style={{ display: "flex", alignItems: "center" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={p.logo} alt="" width={p.size} height={p.size} style={{ width: p.size, height: p.size, borderRadius: p.size * 0.22 }} />
      <div style={{ display: "flex", marginLeft: p.size * 0.3, fontFamily: BODY, fontWeight: 600, fontSize: p.fontSize, letterSpacing: 1.5, color: p.color }}>
        MONKEYTRAVEL
      </div>
      {p.live ? (
        <div
          style={{
            display: "flex",
            marginLeft: 16,
            fontFamily: BODY,
            fontWeight: 600,
            fontSize: p.fontSize * 0.85,
            letterSpacing: 1.5,
            color: WHITE,
            background: CORAL,
            borderRadius: 999,
            padding: "4px 16px",
          }}
        >
          LIVE
        </div>
      ) : null}
    </div>
  );
}

function Pills(p: { items: Pill[]; fontSize: number; onPaper?: boolean }): ReactElement | null {
  if (p.items.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap" }}>
      {p.items.map((pill, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            fontFamily: BODY,
            fontWeight: 600,
            fontSize: p.fontSize,
            color: pill.accent || !p.onPaper ? WHITE : NAVY,
            background: pill.accent ? CORAL : p.onPaper ? "rgba(45,52,54,0.08)" : "rgba(255,255,255,0.16)",
            borderRadius: 999,
            padding: `${Math.round(p.fontSize * 0.4)}px ${Math.round(p.fontSize * 0.85)}px`,
            marginRight: 12,
            marginBottom: 10,
            flexShrink: 1,
          }}
        >
          {pill.text}
        </div>
      ))}
    </div>
  );
}

function Cover(p: { src: string | null; width: number; height: number }): ReactElement {
  return (
    <div style={{ display: "flex", position: "absolute", top: 0, left: 0, width: p.width, height: p.height, background: NAVY }}>
      {p.src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.src} alt="" width={p.width} height={p.height} style={{ width: p.width, height: p.height, objectFit: "cover" }} />
      ) : null}
      <div
        style={{
          display: "flex",
          position: "absolute",
          top: 0,
          left: 0,
          width: p.width,
          height: p.height,
          background: `linear-gradient(180deg, rgba(28,35,38,0.10) 0%, rgba(28,35,38,0.35) 50%, rgba(28,35,38,0.94) 100%)`,
        }}
      />
    </div>
  );
}

function SketchPanel(p: { sketch: Sketch; labelSize: number }): ReactElement {
  const uri = sketchDataUri(sketchSvg(p.sketch, { line: NAVY, ring: PAPER }));
  return (
    <div style={{ display: "flex", position: "relative", width: p.sketch.width, height: p.sketch.height }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={uri} alt="" width={p.sketch.width} height={p.sketch.height} style={{ width: p.sketch.width, height: p.sketch.height }} />
      {p.sketch.labels.map((l, i) => {
        // To the right of the dot, or to its left when that would leave the box.
        const text = clip(l.text, 18);
        const estimated = text.length * p.labelSize * 0.56 + 16;
        const left = l.x + 14 + estimated <= p.sketch.width ? l.x + 14 : Math.max(0, l.x - 14 - estimated);
        return (
        <div
          key={i}
          style={{
            display: "flex",
            position: "absolute",
            left,
            top: Math.max(0, l.y - p.labelSize * 0.9),
            fontFamily: BODY,
            fontWeight: 600,
            fontSize: p.labelSize,
            color: NAVY,
            background: "rgba(255,250,245,0.9)",
            borderRadius: 8,
            padding: "2px 8px",
          }}
        >
          {text}
        </div>
        );
      })}
    </div>
  );
}

function DayRows(p: {
  rows: DayLine[];
  more: number;
  locale: CardLocale;
  rowHeight: number;
  chipWidth: number;
  chipFont: number;
  dateWidth: number;
  textFont: number;
  textWidth: number;
}): ReactElement {
  const c = COPY[p.locale];
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {p.rows.map((r) => (
        <div key={r.day} style={{ display: "flex", alignItems: "center", height: p.rowHeight }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: p.chipWidth,
              height: Math.round(p.rowHeight * 0.62),
              borderRadius: 999,
              background: dayColor(r.day),
              fontFamily: BODY,
              fontWeight: 600,
              fontSize: p.chipFont,
              color: NAVY,
              flexShrink: 0,
            }}
          >
            {c.day(r.day)}
          </div>
          {p.dateWidth > 0 ? (
            <div
              style={{
                display: "flex",
                width: p.dateWidth,
                marginLeft: 16,
                fontFamily: BODY,
                fontSize: p.textFont,
                color: MUTED,
                whiteSpace: "nowrap",
                overflow: "hidden",
                flexShrink: 0,
              }}
            >
              {r.date ?? ""}
            </div>
          ) : null}
          <div
            style={{
              display: "flex",
              width: p.textWidth,
              marginLeft: 16,
              fontFamily: BODY,
              fontSize: p.textFont,
              color: NAVY,
              whiteSpace: "nowrap",
              overflow: "hidden",
            }}
          >
            {r.text}
          </div>
        </div>
      ))}
      {p.more > 0 ? (
        <div style={{ display: "flex", alignItems: "center", height: p.rowHeight, marginLeft: p.chipWidth + 16, fontFamily: BODY, fontSize: p.textFont, color: MUTED }}>
          {c.more(p.more)}
        </div>
      ) : null}
    </div>
  );
}

function Headline(p: { d: TripCardData; logoSize: number; brandFont: number; titleFont: number; subFont: number; width: number }): ReactElement {
  const live = liveLine(p.d);
  return (
    <div style={{ display: "flex", flexDirection: "column", width: p.width }}>
      <Brand logo={p.d.logo} size={p.logoSize} fontSize={p.brandFont} color="#E6EAEE" live={p.d.live !== null} />
      <div
        style={{
          display: "flex",
          marginTop: Math.round(p.titleFont * 0.25),
          fontFamily: DISPLAY,
          fontWeight: 700,
          fontSize: p.titleFont,
          lineHeight: 1.02,
          letterSpacing: -1,
          color: WHITE,
        }}
      >
        {clip(p.d.destination, 48)}
      </div>
      {live ? (
        <div style={{ display: "flex", marginTop: Math.round(p.subFont * 0.4), fontFamily: BODY, fontWeight: 600, fontSize: p.subFont, color: WHITE }}>{live}</div>
      ) : p.d.dates ? (
        <div style={{ display: "flex", marginTop: Math.round(p.subFont * 0.4), fontFamily: BODY, fontSize: p.subFont, color: FOG }}>{p.d.dates}</div>
      ) : null}
    </div>
  );
}

function story(d: TripCardData): ReactElement {
  const { width, height } = CARD_SIZES.story;
  const footerH = 120;
  const overlap = 36;
  const gap = 24;
  // The paper panel takes what its content needs and the photo keeps the rest,
  // so a two-day trip is not a large empty sheet under a small photo.
  const maxPanelH = height - (1040 - overlap) - footerH - gap;
  const sketch = routeSketch(d.days, { width: 920, height: 260 });
  const sketchBlock = sketch ? 260 + 20 : 0;
  const rowHeight = 60;
  const capacity = Math.max(1, Math.floor((maxPanelH - 72 - sketchBlock) / rowHeight));
  const { rows, more } = dayLines(d.days, d.locale, capacity, 40);
  const contentH = 72 + sketchBlock + (rows.length + (more > 0 ? 1 : 0)) * rowHeight;
  const panelH = Math.min(maxPanelH, Math.max(contentH, 200));
  const coverH = height - footerH - gap - panelH + overlap;
  const panelTop = coverH - overlap;
  const c = COPY[d.locale];
  return (
    <div style={{ display: "flex", flexDirection: "column", position: "relative", width, height, background: DEEP, fontFamily: BODY }}>
      <div style={{ display: "flex", position: "relative", width, height: coverH, overflow: "hidden" }}>
        <Cover src={d.cover} width={width} height={coverH} />
        <div style={{ display: "flex", position: "absolute", left: 64, bottom: 84 }}>
          <Headline d={d} logoSize={56} brandFont={26} titleFont={displaySize(d.destination, 104, 88, 68)} subFont={40} width={width - 128} />
        </div>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          position: "absolute",
          top: panelTop,
          left: 40,
          width: width - 80,
          height: panelH,
          background: PAPER,
          borderRadius: 40,
          padding: "36px 40px",
          color: NAVY,
        }}
      >
        {sketch ? (
          <div style={{ display: "flex", marginBottom: 20 }}>
            <SketchPanel sketch={sketch} labelSize={22} />
          </div>
        ) : null}
        {rows.length > 0 ? (
          <DayRows rows={rows} more={more} locale={d.locale} rowHeight={rowHeight} chipWidth={120} chipFont={24} dateWidth={190} textFont={28} textWidth={920 - 120 - 16 - 190 - 16} />
        ) : (
          <div style={{ display: "flex", fontFamily: BODY, fontSize: 30, color: MUTED }}>{c.tagline}</div>
        )}
      </div>
      <div
        style={{
          display: "flex",
          position: "absolute",
          left: 64,
          right: 64,
          bottom: 0,
          height: footerH,
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", fontFamily: BODY, fontWeight: 600, fontSize: 26, color: "#B2BEC3", letterSpacing: 0.5 }}>{c.tagline} · monkeytravel.app</div>
        <div style={{ display: "flex", marginTop: 10 }}>
          <Pills items={pills(d).slice(0, 3)} fontSize={24} />
        </div>
      </div>
    </div>
  );
}

function square(d: TripCardData): ReactElement {
  const { width, height } = CARD_SIZES.square;
  const footerH = 96;
  const overlap = 32;
  const gap = 16;
  const maxPanelH = height - (600 - overlap) - footerH - gap;
  const innerW = width - 72 - 64;
  const sketch = routeSketch(d.days, { width: 340, height: maxPanelH - 56 });
  const rowHeight = 52;
  const textWidth = (sketch ? innerW - 340 - 24 : innerW) - 96 - 16;
  const { rows, more } = dayLines(d.days, d.locale, Math.max(1, Math.floor((maxPanelH - 56) / rowHeight)), sketch ? 34 : 56);
  const rowsH = (rows.length + (more > 0 ? 1 : 0)) * rowHeight;
  // With a sketch the panel keeps its full height (the sketch is drawn to it);
  // without one it takes what the rows need and the photo keeps the rest.
  const panelH = sketch ? maxPanelH : Math.min(maxPanelH, Math.max(56 + rowsH, 160));
  const coverH = height - footerH - gap - panelH + overlap;
  const panelTop = coverH - overlap;
  const c = COPY[d.locale];
  return (
    <div style={{ display: "flex", flexDirection: "column", position: "relative", width, height, background: DEEP, fontFamily: BODY }}>
      <div style={{ display: "flex", position: "relative", width, height: coverH, overflow: "hidden" }}>
        <Cover src={d.cover} width={width} height={coverH} />
        <div style={{ display: "flex", position: "absolute", left: 56, bottom: 72 }}>
          <Headline d={d} logoSize={44} brandFont={22} titleFont={displaySize(d.destination, 80, 66, 52)} subFont={32} width={width - 112} />
        </div>
      </div>
      <div
        style={{
          display: "flex",
          position: "absolute",
          top: panelTop,
          left: 36,
          width: width - 72,
          height: panelH,
          background: PAPER,
          borderRadius: 32,
          padding: "28px 32px",
          color: NAVY,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", width: sketch ? innerW - 340 - 24 : innerW }}>
          {rows.length > 0 ? (
            <DayRows rows={rows} more={more} locale={d.locale} rowHeight={rowHeight} chipWidth={96} chipFont={20} dateWidth={0} textFont={24} textWidth={textWidth} />
          ) : (
            <div style={{ display: "flex", fontFamily: BODY, fontSize: 26, color: MUTED }}>{c.tagline}</div>
          )}
        </div>
        {sketch ? (
          <div style={{ display: "flex", marginLeft: 24 }}>
            <SketchPanel sketch={sketch} labelSize={20} />
          </div>
        ) : null}
      </div>
      <div
        style={{
          display: "flex",
          position: "absolute",
          left: 56,
          right: 56,
          bottom: 0,
          height: footerH,
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", fontFamily: BODY, fontWeight: 600, fontSize: 22, color: "#B2BEC3", letterSpacing: 0.5 }}>monkeytravel.app</div>
        <div style={{ display: "flex", marginTop: 10 }}>
          <Pills items={pills(d).slice(0, 3)} fontSize={22} />
        </div>
      </div>
    </div>
  );
}

function og(d: TripCardData): ReactElement {
  const { width, height } = CARD_SIZES.og;
  const sketch = routeSketch(d.days, { width: 268, height: 268, padding: 24 });
  const textWidth = sketch ? width - 64 - 400 : width - 128;
  return (
    <div style={{ display: "flex", position: "relative", width, height, background: DEEP, fontFamily: BODY }}>
      <Cover src={d.cover} width={width} height={height} />
      {sketch ? (
        <div
          style={{
            display: "flex",
            position: "absolute",
            right: 56,
            top: 56,
            width: 300,
            height: 300,
            padding: 16,
            background: "rgba(255,250,245,0.92)",
            borderRadius: 28,
          }}
        >
          <SketchPanel sketch={sketch} labelSize={18} />
        </div>
      ) : null}
      <div style={{ display: "flex", flexDirection: "column", position: "absolute", left: 64, bottom: 52, width: textWidth }}>
        <Headline d={d} logoSize={40} brandFont={22} titleFont={displaySize(d.destination, 84, 72, 56)} subFont={30} width={textWidth} />
        <div style={{ display: "flex", marginTop: 22 }}>
          <Pills items={pills(d)} fontSize={26} />
        </div>
      </div>
    </div>
  );
}

export function renderTripCard(d: TripCardData, format: CardFormat): ReactElement {
  if (format === "story") return story(d);
  if (format === "square") return square(d);
  return og(d);
}

/** The brand card, for a key that resolves to nothing. */
export function renderBrandCard(format: CardFormat, logo: string): ReactElement {
  const { width, height } = CARD_SIZES[format];
  const size = format === "og" ? 68 : 84;
  return (
    <div style={{ display: "flex", flexDirection: "column", width, height, alignItems: "center", justifyContent: "center", background: DEEP, color: WHITE }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={logo} alt="" width={size * 2} height={size * 2} style={{ width: size * 2, height: size * 2, borderRadius: size * 0.44, marginBottom: 28 }} />
      <div style={{ display: "flex", fontFamily: DISPLAY, fontWeight: 700, fontSize: size, letterSpacing: -1 }}>MonkeyTravel</div>
      <div style={{ display: "flex", fontFamily: BODY, fontSize: Math.round(size * 0.44), color: "#9AA5B1", marginTop: 14 }}>AI trip planning</div>
    </div>
  );
}
