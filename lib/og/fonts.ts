/**
 * The site's faces for the image renderer. next/og bundles one regular face,
 * so the card fetches Fraunces and Source Sans 3 from Google Fonts as TrueType
 * (the CSS endpoint serves TTF to an old user agent) and keeps them for the
 * life of the function instance. A face that fails to load is left out, and
 * satori falls back to the first face it has.
 */
const TTF_USER_AGENT =
  "Mozilla/5.0 (Macintosh; U; Intel Mac OS X 10_6_8; de-at) AppleWebKit/533.21.1 (KHTML, like Gecko) Version/5.0.5 Safari/533.21.1";

export interface CardFont {
  name: string;
  data: ArrayBuffer;
  weight: 400 | 600 | 700;
  style: "normal";
}

const WANTED: { name: string; weight: CardFont["weight"] }[] = [
  { name: "Fraunces", weight: 700 },
  { name: "Source Sans 3", weight: 400 },
  { name: "Source Sans 3", weight: 600 },
];

const cache = new Map<string, Promise<ArrayBuffer | null>>();

async function fetchTtf(name: string, weight: number): Promise<ArrayBuffer | null> {
  try {
    const css = await fetch(
      `https://fonts.googleapis.com/css2?family=${name.replace(/ /g, "+")}:wght@${weight}`,
      { headers: { "User-Agent": TTF_USER_AGENT } }
    );
    if (!css.ok) return null;
    const match = (await css.text()).match(/src:\s*url\(([^)]+)\)\s*format\('(?:truetype|opentype)'\)/);
    if (!match) return null;
    const file = await fetch(match[1]);
    return file.ok ? file.arrayBuffer() : null;
  } catch {
    return null;
  }
}

function loadFont(name: string, weight: number): Promise<ArrayBuffer | null> {
  const key = `${name}:${weight}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = fetchTtf(name, weight).then((data) => {
      if (!data) cache.delete(key); // try again on the next card
      return data;
    });
    cache.set(key, pending);
  }
  return pending;
}

export async function cardFonts(): Promise<CardFont[]> {
  const loaded = await Promise.all(
    WANTED.map(async (f) => {
      const data = await loadFont(f.name, f.weight);
      return data ? { name: f.name, data, weight: f.weight, style: "normal" as const } : null;
    })
  );
  return loaded.filter((f): f is CardFont => f !== null);
}
