/**
 * The match's card: one picture of a result, as a link preview, a square and a
 * story. Drawn by satori through app/api/og/match, so every box with more than
 * one child says display:flex and text is clipped here, not by CSS.
 */
import type { ReactElement, ReactNode } from "react";
import { CARD_SIZES, clip, type CardFormat } from "@/lib/og/trip-card";

export interface MatchCardImages {
  /** The photo and the logo as data; either can be missing when it couldn't be loaded. */
  cover: string | null;
  logo: string | null;
}

export interface MatchCardData extends MatchCardImages {
  /** The small line over the place: the travel type, or "our place". */
  overline: string;
  place: string;
  country: string;
  percent: string;
  /** Who it's for, on a card for several people. */
  people?: string;
  invite: string;
}

const INK = "#14181A";
const WHITE = "#FFFFFF";
const FOG = "#E6EAEE";
const DISPLAY = "Fraunces";
const BODY = "Source Sans 3";
const SITE = "monkeytravel.app/where-should-i-go";

const SCALE: Record<CardFormat, { pad: number; place: number; placeLong: number; overline: number; country: number; pill: number; invite: number; logo: number; brand: number }> = {
  og: { pad: 56, place: 108, placeLong: 80, overline: 28, country: 36, pill: 30, invite: 30, logo: 44, brand: 24 },
  square: { pad: 64, place: 136, placeLong: 100, overline: 34, country: 44, pill: 36, invite: 36, logo: 56, brand: 28 },
  story: { pad: 76, place: 176, placeLong: 124, overline: 42, country: 56, pill: 44, invite: 44, logo: 68, brand: 32 },
};

/** Dark where the words sit: down the left of the wide card, along the bottom of the tall ones. */
const SCRIM: Record<CardFormat, string> = {
  og: "linear-gradient(90deg, rgba(20,24,26,0.94) 0%, rgba(20,24,26,0.8) 40%, rgba(20,24,26,0.15) 74%, rgba(20,24,26,0) 100%)",
  square: "linear-gradient(180deg, rgba(20,24,26,0.5) 0%, rgba(20,24,26,0.05) 20%, rgba(20,24,26,0.35) 38%, rgba(20,24,26,0.8) 58%, rgba(20,24,26,0.95) 100%)",
  story: "linear-gradient(180deg, rgba(20,24,26,0.5) 0%, rgba(20,24,26,0.05) 26%, rgba(20,24,26,0.2) 44%, rgba(20,24,26,0.7) 62%, rgba(20,24,26,0.95) 100%)",
};
const INVITE_SCRIM = "linear-gradient(180deg, rgba(20,24,26,0.5) 0%, rgba(20,24,26,0.15) 28%, rgba(20,24,26,0.8) 60%, rgba(20,24,26,0.95) 100%)";

/** The photo, the brand in the corner, and the words at the bottom. */
function Frame(p: MatchCardImages & { format: CardFormat; scrim: string; children: ReactNode }): ReactElement {
  const { width, height } = CARD_SIZES[p.format];
  const s = SCALE[p.format];
  return (
    <div style={{ display: "flex", position: "relative", width, height, background: INK, fontFamily: BODY }}>
      {p.cover ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.cover} alt="" width={width} height={height} style={{ position: "absolute", top: 0, left: 0, width, height, objectFit: "cover" }} />
      ) : null}
      <div style={{ display: "flex", position: "absolute", top: 0, left: 0, width, height, background: p.scrim }} />
      <div style={{ display: "flex", position: "absolute", top: s.pad, left: s.pad, alignItems: "center" }}>
        {p.logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.logo} alt="" width={s.logo} height={s.logo} style={{ width: s.logo, height: s.logo, borderRadius: s.logo * 0.22, marginRight: s.logo * 0.3 }} />
        ) : null}
        <div style={{ display: "flex", fontWeight: 600, fontSize: s.brand, letterSpacing: 1.5, color: FOG }}>MONKEYTRAVEL</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", position: "absolute", left: s.pad, right: s.pad, bottom: s.pad }}>{p.children}</div>
    </div>
  );
}

export function renderMatchCard(d: MatchCardData, format: CardFormat): ReactElement {
  const s = SCALE[format];
  const place = clip(d.place, 22);
  return (
    <Frame cover={d.cover} logo={d.logo} format={format} scrim={SCRIM[format]}>
      <div style={{ display: "flex", fontWeight: 600, fontSize: s.overline, letterSpacing: 2, color: FOG, textTransform: "uppercase" }}>{clip(d.overline, 36)}</div>
      <div
        style={{
          display: "flex",
          marginTop: Math.round(s.overline * 0.3),
          fontFamily: DISPLAY,
          fontWeight: 700,
          fontSize: place.length <= 9 ? s.place : s.placeLong,
          lineHeight: 1.02,
          letterSpacing: -2,
          color: WHITE,
        }}
      >
        {place}
      </div>
      <div style={{ display: "flex", marginTop: Math.round(s.country * 0.2), fontSize: s.country, color: FOG }}>{clip(d.country, 30)}</div>
      <div style={{ display: "flex", alignItems: "center", marginTop: Math.round(s.pill * 0.8), flexWrap: "wrap" }}>
        <div
          style={{
            display: "flex",
            fontWeight: 600,
            fontSize: s.pill,
            color: INK,
            background: WHITE,
            borderRadius: 999,
            padding: `${Math.round(s.pill * 0.32)}px ${Math.round(s.pill * 0.8)}px`,
            marginRight: 16,
          }}
        >
          {d.percent}
        </div>
        {d.people ? <div style={{ display: "flex", fontWeight: 600, fontSize: s.pill, color: WHITE }}>{d.people}</div> : null}
      </div>
      <div style={{ display: "flex", marginTop: Math.round(s.invite * 0.9), fontFamily: DISPLAY, fontWeight: 700, fontSize: s.invite * 1.2, color: WHITE }}>{d.invite}</div>
      <div style={{ display: "flex", marginTop: Math.round(s.invite * 0.2), fontWeight: 600, fontSize: s.invite * 0.72, color: FOG }}>{SITE}</div>
    </Frame>
  );
}

/** The page's own card: the question, on a photo, before anyone has answered. */
export function renderMatchInvite(d: MatchCardImages & { title: string; subtitle: string }, format: CardFormat): ReactElement {
  const s = SCALE[format];
  return (
    <Frame cover={d.cover} logo={d.logo} format={format} scrim={INVITE_SCRIM}>
      <div style={{ display: "flex", fontFamily: DISPLAY, fontWeight: 700, fontSize: s.placeLong, lineHeight: 1.04, letterSpacing: -1.5, color: WHITE }}>{d.title}</div>
      <div style={{ display: "flex", marginTop: Math.round(s.country * 0.4), fontSize: s.country, color: FOG }}>{d.subtitle}</div>
      <div style={{ display: "flex", marginTop: Math.round(s.invite * 0.5), fontWeight: 600, fontSize: s.invite * 0.72, color: FOG }}>{SITE}</div>
    </Frame>
  );
}
