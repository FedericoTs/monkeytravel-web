/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommonsFile } from "./wikimedia";

/**
 * An activity's Wikimedia photo is the photo of the Wikidata item that is the
 * same place: named alike, near the activity, and a sight rather than its
 * hotel, its station or a rose named after it. A wrong photo is worse than
 * none, so anything uncertain finds nothing.
 */

type Item = { labels: string[]; aliases?: string[]; at?: [number, number]; kinds?: string[]; images?: Record<string, string[]> };
let items: Record<string, Item>;
let found: Record<string, string[]>;
const searches: string[] = [];
let files: CommonsFile[];

const wiki = vi.fn(async (_base: string, params: Record<string, string | number>) => {
  if (params.list === "search") {
    const text = String(params.srsearch);
    searches.push(text);
    return { query: { search: (found[text.split(" haswbstatement")[0]] ?? []).map((title) => ({ title })) } };
  }
  const ids = String(params.ids).split("|");
  const entities: Record<string, unknown> = {};
  for (const id of ids) {
    const item = items[id];
    if (!item) continue;
    entities[id] =
      params.props === "claims"
        ? {
            claims: {
              ...(item.at ? { P625: [{ mainsnak: { datavalue: { value: { latitude: item.at[0], longitude: item.at[1] } } } }] } : {}),
              P31: (item.kinds ?? []).map((k) => ({ mainsnak: { datavalue: { value: { id: k } } } })),
              ...Object.fromEntries(Object.entries(item.images ?? {}).map(([p, names]) => [p, names.map((n) => ({ mainsnak: { datavalue: { value: n } } }))])),
            },
          }
        : {
            labels: Object.fromEntries(item.labels.map((value, i) => [i ? `l${i}` : "en", { value }])),
            aliases: { en: (item.aliases ?? []).map((value) => ({ value })) },
          };
  }
  return { entities };
});
const commonsFiles = vi.fn(async (names: string[]) => names.flatMap((n) => files.filter((f) => f.name === n)));
const storePhoto = vi.fn(async (_db: unknown, f: CommonsFile, widths: number[]) => widths.map((w) => `/api/images/wikimedia/aaaaaaaaaaaaaaaaaaaa-${w}.jpg?f=${f.name}`));

vi.mock("@/lib/images/wikimedia", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./wikimedia")>()),
  wiki: (...a: Parameters<typeof wiki>) => wiki(...a),
  commonsFiles: (...a: Parameters<typeof commonsFiles>) => commonsFiles(...a),
  storePhoto: (...a: Parameters<typeof storePhoto>) => storePhoto(...a),
}));

const { buildLandmarkPhoto, findLandmarkPhoto, itemMatch, nameMatch, nameTokens, nameVariants } = await import("./wikimedia-landmark");

const photo = (name: string, extra: Partial<CommonsFile> = {}): CommonsFile => ({
  name,
  thumb: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${name}/960px-${name}`,
  width: 3000,
  height: 2000,
  mime: "image/jpeg",
  license: "CC BY-SA 4.0",
  artist: "A Photographer",
  restrictions: "",
  ...extra,
});
const PARIS: [number, number] = [48.8584, 2.2945];
const signal = new AbortController().signal;
const match = (a: string, b: string) => nameMatch(nameTokens(a), nameTokens(b));

beforeEach(() => {
  items = {};
  found = {};
  files = [];
  searches.length = 0;
  vi.clearAllMocks();
});

describe("nameTokens", () => {
  it("compares words without accents, small words, plurals or the language of a kind of place", () => {
    expect(nameTokens("Basilique du Sacré-Cœur de Montmartre")).toEqual(["basilica", "sacre", "coeur", "montmartre"]);
    expect(nameTokens("Museu Picasso")).toEqual(nameTokens("Picasso Museum").reverse());
    expect(nameTokens("Tegallalang Rice Terraces")).toEqual(nameTokens("Tegallalang Rice Terrace"));
  });
});

describe("nameVariants", () => {
  it("names the place without what the activity does there, and each part of a double name", () => {
    expect(nameVariants(["Lunch at Katz's Delicatessen"])).toContain("Katz's Delicatessen");
    expect(nameVariants(["La Pedrera - Casa Milà"])).toEqual(expect.arrayContaining(["La Pedrera", "Casa Milà"]));
    expect(nameVariants(["Kinkaku-ji (Golden Pavilion)"])).toEqual(expect.arrayContaining(["Kinkaku-ji", "Golden Pavilion"]));
  });

  it("drops a part that only says what kind of place it is", () => {
    expect(nameVariants(["Restaurant - Cervejaria Ramiro"])).not.toContain("Restaurant");
  });
});

describe("nameMatch", () => {
  it("matches the same place under another wording, language or extra kind word", () => {
    for (const [a, b] of [
      ["Meiji Jingu", "Meiji Jingū"],
      ["Meiji Jingu", "Meiji Shrine"],
      ["Fish Market Tsukiji Outer Market", "Tsukiji fish market"],
      ["Basilica of the Sagrada Familia", "Sagrada Família"],
      ["Imperial Palace East National Gardens", "East Gardens of the Imperial Palace"],
      ["Picasso Museum Barcelona", "Museu Picasso"],
      ["Yanaka Ginza", "Yanaka Ginza Shopping Street"],
      ["Hamarikyu Gardens", "Hama-rikyū Gardens"],
      ["Hachiko Statue", "Statue of Hachikō"],
      ["Eiffel Tower", "Tour Eiffel"],
    ]) {
      expect(match(a, b), `${a} / ${b}`).toBeGreaterThan(0);
    }
  });

  it("does not take a neighbour, a part, or another thing named after the place", () => {
    for (const [a, b] of [
      ["Times Square", "Times Square Ball"],
      ["Old Town Square", "Old Town Square Hotel"],
      ["Asakusa", "Asakusa Station"],
      ["Musée de Montmartre", "Montmartre"],
      ["Armando al Pantheon", "Pantheon"],
      ["La Galerie", "Berlinische Galerie"],
      ["Prague Jewish Quarter", "Jewish Museum in Prague"],
      ["Narita International Airport", "Narita International Airport Corporation"],
      ["Eiffel Tower", "Rosa 'Eiffel Tower'"],
    ]) {
      expect(match(a, b), `${a} / ${b}`).toBe(0);
    }
  });

  it("ranks a label above an alias with the same words", () => {
    const variants = ["Asakusa"];
    expect(itemMatch(variants, { labels: { en: { value: "Asakusa" } } })).toBeGreaterThan(
      itemMatch(variants, { labels: { en: { value: "Senso" } }, aliases: { en: [{ value: "Asakusa" }] } }),
    );
  });
});

describe("findLandmarkPhoto", () => {
  it("takes the best-named item near the activity, and its first usable view", async () => {
    found["Eiffel Tower"] = ["Q1", "Q2"];
    items.Q1 = { labels: ["Rosa 'Eiffel Tower'"], images: { P18: ["Rose.jpg"] } };
    items.Q2 = { labels: ["Eiffel Tower", "Tour Eiffel"], at: [48.8583, 2.2944], images: { P18: ["Tower portrait.jpg"], P3451: ["Tower at night.jpg"] } };
    files = [photo("Tower portrait.jpg", { width: 2000, height: 3000 }), photo("Tower at night.jpg"), photo("Rose.jpg")];
    const result = await findLandmarkPhoto({ names: ["Eiffel Tower"], lat: PARIS[0], lng: PARIS[1] }, signal);
    expect(result?.name).toBe("Tower at night.jpg");
    expect(searches[0]).toBe("Eiffel Tower haswbstatement:P18 nearcoord:1500m,48.85840,2.29450");
  });

  it("finds nothing when the place named alike is far away, or is a station", async () => {
    found["Old Town Square"] = ["Q3"];
    items.Q3 = { labels: ["Old Town Square"], at: [50.0875, 14.4213], images: { P18: ["Square.jpg"] } };
    files = [photo("Square.jpg")];
    expect(await findLandmarkPhoto({ names: ["Old Town Square"], lat: PARIS[0], lng: PARIS[1] }, signal)).toBeNull();

    found["Canal Saint-Martin"] = ["Q4"];
    items.Q4 = { labels: ["Canal Saint-Martin"], at: PARIS, kinds: ["Q953806"], images: { P18: ["Stop.jpg"] } };
    files = [photo("Stop.jpg")];
    expect(await findLandmarkPhoto({ names: ["Canal Saint-Martin"], lat: PARIS[0], lng: PARIS[1] }, signal)).toBeNull();
  });

  it("searches for any of the words when all of them find nothing named alike", async () => {
    found["Sacred Monkey Forest Sanctuary"] = [];
    found["Sacred OR Monkey OR Forest OR Sanctuary"] = ["Q5"];
    items.Q5 = { labels: ["Ubud Monkey Forest"], aliases: ["Sacred Monkey Forest Sanctuary"], at: [-8.519, 115.258], images: { P18: ["Forest.jpg"] } };
    files = [photo("Forest.jpg")];
    const result = await findLandmarkPhoto({ names: ["Sacred Monkey Forest Sanctuary"], lat: -8.5188, lng: 115.2585 }, signal);
    expect(result?.name).toBe("Forest.jpg");
    expect(searches).toHaveLength(2);
  });

  it("finds nothing for a restaurant Wikidata doesn't know", async () => {
    found["Restaurante O Frade"] = ["Q6"];
    items.Q6 = { labels: ["Monumento Natural O Frade"], at: [38.7, -9.2], images: { P18: ["Rock.jpg"] } };
    expect(await findLandmarkPhoto({ names: ["Restaurante O Frade"], lat: 38.7, lng: -9.2 }, signal)).toBeNull();
  });
});

describe("buildLandmarkPhoto", () => {
  it("stores the photo at card and sheet widths and serves the card one", async () => {
    found["Belém Tower"] = ["Q7"];
    items.Q7 = { labels: ["Belém Tower"], at: [38.6916, -9.216], images: { P18: ["Belem.jpg"] } };
    files = [photo("Belem.jpg")];
    const url = await buildLandmarkPhoto({} as never, { names: ["Belém Tower"], lat: 38.6916, lng: -9.216 }, signal);
    expect(storePhoto).toHaveBeenCalledWith({}, files[0], [500, 960], signal);
    expect(url).toBe("/api/images/wikimedia/aaaaaaaaaaaaaaaaaaaa-500.jpg?f=Belem.jpg");
  });
});
