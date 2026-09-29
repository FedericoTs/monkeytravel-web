/**
 * Translates the curated templates' itineraries (day titles, themes, notes,
 * activity names, descriptions, tips), packing lists and trip_meta texts
 * (highlights, weather note, packing suggestions, best-for) into es, it and
 * pt with Gemini, into lib/templates/itineraries/<trip id>.<locale>.json, and
 * rewrites the index that lib/templates/text.ts reads. Existing files are
 * kept unless --force, so a re-run only fills gaps.
 *
 * usage: npx tsx scripts/translate-template-itineraries.mts [--only <trip id>] [--locale <es|it|pt>] [--force]
 * needs: SUPABASE service role + GOOGLE_AI_API_KEY (read from .env.local)
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const OUT_DIR = join(ROOT, "lib/templates/itineraries");
const LOCALES = { es: "Spanish (Spain)", it: "Italian", pt: "Portuguese (Brazil)" } as const;
type Locale = keyof typeof LOCALES;

function env(name: string): string {
  if (process.env[name]) return process.env[name] as string;
  for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (m && m[1] === name) return m[2].trim().replace(/^["']|["']$/g, "");
  }
  throw new Error(`${name} missing`);
}

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i > -1 ? args[i + 1] : undefined;
};
const only = flag("--only");
const onlyLocale = flag("--locale") as Locale | undefined;
const force = args.includes("--force");

interface Activity {
  name: string;
  description?: string;
  tips?: string[];
}
interface Day {
  title: string;
  theme?: string;
  notes?: string;
  activities: Activity[];
}
interface Meta {
  highlights?: string[];
  weather_note?: string;
  packing_suggestions?: string[];
  destination_best_for?: string[];
}
const META_LISTS = ["highlights", "packing_suggestions", "destination_best_for"] as const;
interface Translation {
  days: Day[];
  packing: string[];
  meta: Meta;
}

function translatableMeta(meta: Record<string, unknown>): Meta {
  const out: Meta = {};
  for (const key of META_LISTS) {
    const value = meta[key];
    if (Array.isArray(value) && value.length) out[key] = value.map(String);
  }
  if (typeof meta.weather_note === "string" && meta.weather_note.trim()) out.weather_note = meta.weather_note;
  return out;
}

/** Only the strings a traveller reads; everything else stays with the row. */
function translatable(itinerary: Array<Record<string, unknown>>, packing: unknown, meta: unknown): Translation {
  return {
    days: itinerary.map((day) => ({
      title: String(day.title ?? ""),
      ...(day.theme ? { theme: String(day.theme) } : {}),
      ...(day.notes ? { notes: String(day.notes) } : {}),
      activities: ((day.activities as Array<Record<string, unknown>>) ?? []).map((a) => ({
        name: String(a.name ?? ""),
        ...(a.description ? { description: String(a.description) } : {}),
        ...(Array.isArray(a.tips) && a.tips.length ? { tips: a.tips.map(String) } : {}),
      })),
    })),
    packing: Array.isArray(packing) ? packing.map(String) : [],
    meta: translatableMeta(meta && typeof meta === "object" ? (meta as Record<string, unknown>) : {}),
  };
}

function sameShape(english: Translation, translated: Translation): string | null {
  if (translated.days?.length !== english.days.length) return "day count";
  for (let d = 0; d < english.days.length; d++) {
    const e = english.days[d];
    const t = translated.days[d];
    if (!t?.title?.trim()) return `day ${d + 1} title`;
    if (t.activities?.length !== e.activities.length) return `day ${d + 1} activity count`;
    for (let a = 0; a < e.activities.length; a++) {
      const ea = e.activities[a];
      const ta = t.activities[a];
      if (!ta?.name?.trim()) return `day ${d + 1} activity ${a + 1} name`;
      if (ea.description && !ta.description?.trim()) return `day ${d + 1} activity ${a + 1} description`;
      if (ea.tips && ta.tips?.length !== ea.tips.length) return `day ${d + 1} activity ${a + 1} tips`;
    }
  }
  if (translated.packing?.length !== english.packing.length) return "packing count";
  for (const key of META_LISTS) {
    if (english.meta[key] && translated.meta?.[key]?.length !== english.meta[key].length) return `meta ${key}`;
  }
  if (english.meta.weather_note && !translated.meta?.weather_note?.trim()) return "meta weather_note";
  return null;
}

async function gemini(prompt: string): Promise<{ text: string; finishReason: string }> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env("GOOGLE_AI_API_KEY")}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        // Thinking shares the output budget; a translation does not need it.
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.2,
          maxOutputTokens: 65536,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
  };
  const candidate = json.candidates?.[0];
  return {
    text: candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "",
    finishReason: candidate?.finishReason ?? "none",
  };
}

async function translate(english: Translation, destination: string, locale: Locale): Promise<Translation> {
  const prompt = [
    `You translate travel itineraries for a trip-planning app. Translate every string value in the JSON below from English to ${LOCALES[locale]}.`,
    "Rules:",
    "- Keep the exact JSON structure, key names and array lengths; translate values only.",
    "- Write naturally for a traveller, in the informal register (tu / você), the way a good local guidebook reads.",
    "- Keep proper names of places, venues, dishes, transport lines and brands the way a local would write them (for example 'Torre Eiffel', 'Sagrada Família', 'Le Marais').",
    "- Keep times, prices, numbers, currencies and URLs unchanged.",
    "- Do not add, remove or reorder items. Return only the JSON.",
    `Destination: ${destination}.`,
    "",
    JSON.stringify(english),
  ].join("\n");
  let lastProblem = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { text, finishReason } = await gemini(prompt);
    try {
      const parsed = JSON.parse(text) as Translation;
      const problem = sameShape(english, parsed);
      if (!problem) return parsed;
      lastProblem = problem;
      console.warn(`   attempt ${attempt}: shape mismatch at ${problem}`);
    } catch {
      lastProblem = `invalid JSON (${finishReason}, ${text.length} chars)`;
      console.warn(`   attempt ${attempt}: ${lastProblem} …${JSON.stringify(text.slice(-80))}`);
    }
  }
  throw new Error(`could not translate ${destination} to ${locale}: ${lastProblem}`);
}

function writeIndex() {
  const files = readdirSync(OUT_DIR).filter((f) => /^[0-9a-f-]{36}\.(es|it|pt)\.json$/.test(f)).sort();
  const byId = new Map<string, string[]>();
  for (const f of files) {
    const [id, locale] = f.split(".");
    byId.set(id, [...(byId.get(id) ?? []), locale]);
  }
  const imports: string[] = [];
  const entries: string[] = [];
  let n = 0;
  for (const [id, locales] of byId) {
    const parts: string[] = [];
    for (const locale of locales) {
      const name = `t${n++}`;
      imports.push(`import ${name} from "./${id}.${locale}.json";`);
      parts.push(`${locale}: ${name}`);
    }
    entries.push(`  "${id}": { ${parts.join(", ")} },`);
  }
  const source = [
    "// Generated by scripts/translate-template-itineraries.mts; do not edit by hand.",
    'import type { TemplateTranslation } from "../text";',
    ...imports,
    "",
    'export const TEMPLATE_ITINERARIES: Record<string, Partial<Record<"es" | "it" | "pt", TemplateTranslation>>> = {',
    ...entries,
    "};",
    "",
  ].join("\n");
  writeFileSync(join(OUT_DIR, "index.ts"), source);
}

async function main() {
  const supabase = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let query = supabase
    .from("trips")
    .select("id, template_destination, itinerary, packing_list, trip_meta")
    .eq("is_template", true)
    .eq("visibility", "public")
    .order("template_featured_order", { ascending: true, nullsFirst: false });
  if (only) query = query.eq("id", only);
  const { data: templates, error } = await query;
  if (error) throw error;
  mkdirSync(OUT_DIR, { recursive: true });

  let written = 0;
  let kept = 0;
  for (const template of templates ?? []) {
    const english = translatable(template.itinerary ?? [], template.packing_list, template.trip_meta);
    for (const locale of Object.keys(LOCALES) as Locale[]) {
      if (onlyLocale && locale !== onlyLocale) continue;
      const out = join(OUT_DIR, `${template.id}.${locale}.json`);
      if (existsSync(out) && !force) {
        kept++;
        continue;
      }
      console.log(`📝 ${template.template_destination} → ${locale} (${english.days.length} days)`);
      const translated = await translate(english, template.template_destination, locale);
      writeFileSync(out, `${JSON.stringify(translated, null, 2)}\n`);
      written++;
    }
  }
  writeIndex();
  console.log(`\n✅ ${written} written, ${kept} kept`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
