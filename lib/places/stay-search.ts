/**
 * "Where are you staying?": hotels, streets and areas near the destination,
 * from Photon (lib/places/photon.ts), OpenStreetMap's free geocoder, so the
 * answer costs nothing and isn't Google data we'd have to keep away from.
 *
 * Results are held to a box around the destination, and only places a person
 * can stay in or near come back: no countries, regions or whole cities.
 */
import { resolvePhotonLang } from "./photon";

export interface StayPlace {
  /** What the field shows and the plan is told: the place's name, or its street address. */
  name: string;
  /** The street and the area, to tell two places of the same name apart. */
  detail: string;
  lat: number;
  lng: number;
}

/** About 45 km either side of the destination: far enough for its suburbs, not the next city. */
export const STAY_BOX_DEGREES = 0.4;
export const STAY_RESULTS_MAX = 5;
const PHOTON_TIMEOUT_MS = 1500;
/** A country, a region or a whole city is not where anyone stays. */
const TOO_WIDE = new Set(["country", "state", "region", "province", "county", "city", "town", "municipality", "island"]);

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    name?: string;
    street?: string;
    housenumber?: string;
    district?: string;
    locality?: string;
    city?: string;
    osm_key?: string;
    osm_value?: string;
    type?: string;
  };
}

/** The places in a Photon answer someone could stay at, named and placed, at most STAY_RESULTS_MAX. */
export function stayPlaces(features: readonly PhotonFeature[]): StayPlace[] {
  const places: StayPlace[] = [];
  const seen = new Set<string>();
  for (const feature of features) {
    const p = feature.properties ?? {};
    const [lng, lat] = feature.geometry?.coordinates ?? [];
    if (typeof lat !== "number" || typeof lng !== "number") continue;
    if (TOO_WIDE.has(p.type ?? "") || (p.osm_key === "place" && TOO_WIDE.has(p.osm_value ?? ""))) continue;
    const street = p.street ? [p.street, p.housenumber].filter(Boolean).join(" ") : "";
    const name = p.name?.trim() || street;
    if (!name) continue;
    const area = p.district || p.locality || "";
    const detail = [street !== name ? street : "", area !== name ? area : "", p.city !== name ? p.city : ""]
      .filter((part, i, all): part is string => Boolean(part) && all.indexOf(part) === i)
      .join(", ");
    const key = `${name}|${detail}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    places.push({ name, detail, lat, lng });
    if (places.length === STAY_RESULTS_MAX) break;
  }
  return places;
}

/** Photon's answer for what was typed, near the destination. Empty on any failure: the field still takes free text. */
export async function searchStays(input: string, near: { lat: number; lng: number }, locale?: string): Promise<StayPlace[]> {
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", input);
  url.searchParams.set("lat", String(near.lat));
  url.searchParams.set("lon", String(near.lng));
  const d = STAY_BOX_DEGREES;
  url.searchParams.set("bbox", [near.lng - d, near.lat - d, near.lng + d, near.lat + d].map((n) => n.toFixed(4)).join(","));
  url.searchParams.set("limit", "10");
  url.searchParams.set("lang", resolvePhotonLang(locale));
  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(PHOTON_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { features?: PhotonFeature[] };
    return stayPlaces(json.features ?? []);
  } catch {
    return [];
  }
}
