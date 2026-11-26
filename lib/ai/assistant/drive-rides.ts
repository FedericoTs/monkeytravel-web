/**
 * "We'll travel by car for the whole trip". A trip through several cities holds its rides between them (a train, a
 * bus, a flight: lib/ai/transfer-legs.ts), and here a drive replaces each one, in code, every time. Left to the
 * model, the same ask got the drives once, a talk about driving the next time, and twice "I can't keep details like
 * that": the model is told that how they get from stop to stop is a question (edit-prompt.ts), and it took the
 * rides for that too.
 *
 * Only an ask that is all about the car comes here, for the whole route. "Drive from Lyon to Nice" (a city named), a
 * car on one day, or a car beside other changes goes to the model as before. A ride stays, and the reply says why,
 * when no road makes the hop (a ferry, a hop to or from an island, a flight outside the lands a drive is measured
 * for), when the drive would take more than a long day, or when it's one of the traveller's fixed plans.
 */
import type { Activity, ItineraryDay } from "@/types";
import { arrivalDay, buildTransferActivity, haversineKm, middleOf, onSameLand } from "@/lib/ai/transfer-legs";
import { isLockedActivity } from "@/lib/ai/anchors-core";
import { formatDuration } from "@/lib/datetime/duration";
import type { SupportedLanguage } from "@/lib/ai/language";
import { cityKey } from "./city-days";
import { dayMentioned } from "./day-target";
import type { DayEdit } from "./edit-validation";

const plain = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Going by car, said as the way they travel. */
const CAR_WAY =
  /(?<![\p{L}])(?:by car|by road|road ?trip|rent(?:ing|ed)? (?:a )?car|hire (?:a )?car|rental car|(?:have|has|got|bring|bringing|take|taking) (?:a |our |my |the )?(?:own )?car|en (?:coche|carro|auto)|alquil\p{L}* (?:un )?(?:coche|carro|auto)|(?:tenemos|tengo|llevamos) (?:un |el )?(?:coche|carro|auto)|in (?:macchina|auto)|noleggi\p{L}* (?:un'?|l'|la )?(?:auto|macchina)|(?:abbiamo|ho) (?:la |l'|una |un'?)?(?:macchina|auto)|de carro|alug\p{L}* (?:um )?carro|carro alugado|(?:temos|tenho|levamos) (?:um |o )?carro)(?![\p{L}])/iu;
/** Driving, which also names a drive as a thing to do ("a scenic drive"): it needs WHOLE_OR_INSTEAD with it. */
const DRIVING =
  /(?<![\p{L}])(?:drive|driving|conducir|conduciendo|conduciremos|manejar|manejando|guidare|guidando|guideremo|dirigir|dirigindo|dirigiremos)(?![\p{L}])/iu;
const WHOLE_OR_INSTEAD =
  /(?<![\p{L}])(?:whole|entire|all the way|everywhere|instead|rather than|todo el|toda la|todos los|en vez|en lugar|tutto il|tutta la|tutti i|intero|invece|al posto|toda a|todo o|todos os|em vez|ao inv[eé]s)(?![\p{L}])/iu;
/** The rides named as what the car replaces: "change the trains to a car", "trenes por coche". */
const RIDES_TO_CAR =
  /(?<![\p{L}])(?:trains?|flights?|planes?|bus(?:es)?|trenes|vuelos|treni|voli|trens|voos)\s+(?:to|for|with|into|by|per|con|in|por|para|a|en|de|com)\s+(?:(?:a|an|the|un|una|el|la|o|um|uma)\s+|un'|l')?(?:cars?|coche|carro|auto|macchina)(?![\p{L}])/iu;
/** Other ways of getting there, which an ask may want beside the car ("and trains that carry the car"). */
const OTHER_WAYS =
  /(?<![\p{L}])(?:trains?|flights?|planes?|bus(?:es)?|ferry|ferries|boats?|tren|trenes|vuelos?|autob[uú]s|barcos?|ferri|treno|treni|volo|voli|traghett[oi]|trem|trens|voos?|[oô]nibus|balsas?)(?![\p{L}])/iu;
/** The car in place of them: "instead of the trains". */
const SWAP =
  /(?<![\p{L}])(?:instead|rather than|replace|swap|change|en vez|en lugar|cambia\p{L}*|invece|al posto|sostitui\p{L}*|em vez|ao inv[eé]s|troca\p{L}*|substitu\p{L}*|muda\p{L}*)(?![\p{L}])/iu;
/** No car, or no driving. */
const NO_CAR =
  /(?<![\p{L}])(?:no car|(?:don'?t|do not|won'?t) (?:have|rent|hire|want|need) (?:a )?car|without (?:a )?car|(?:can'?t|cannot|won'?t|don'?t|do not|not) (?:be )?driv\p{L}*|no driving|sin (?:coche|carro|auto)|no (?:tenemos|tengo|queremos) (?:coche|carro|auto)|no (?:conduc|manej)\p{L}*|senza (?:macchina|auto)|non (?:abbiamo|ho|vogliamo) (?:la |l'|una |un'?)?(?:macchina|auto)|non guid\p{L}*|sem carro|n[ãa]o (?:temos|tenho|queremos) carro|n[ãa]o dirig\p{L}*)(?![\p{L}])/iu;
/** Weighing the car up rather than asking for it: the model answers those. */
const WEIGHING =
  /(?<![\p{L}])(?:should|worth|better|recommend\p{L}*|conviene|vale la pena|mejor|meglio|consigli\p{L}*|melhor|vale a pena|recomend\p{L}*)(?![\p{L}])/iu;
/**
 * The language of a car ask, from its own words: too short for the general reading of a message's language
 * (honesty.ts replyLanguage), "vamos de carro" reads as Spanish or as nothing.
 */
const ASK_LANGUAGE: [SupportedLanguage, RegExp][] = [
  ["pt", /(?<![\p{L}])(?:de carro|dirig\p{L}*|alug\p{L}*|carro alugado|temos|tenho|levamos|viagem|n[ãa]o)(?![\p{L}])/iu],
  ["it", /(?<![\p{L}])(?:in (?:macchina|auto)|macchina|guid\p{L}*|noleggi\p{L}*|abbiamo|viaggio|invece)(?![\p{L}])/iu],
  ["es", /(?<![\p{L}])(?:en (?:coche|carro|auto)|coche|conduc\p{L}*|manej\p{L}*|alquil\p{L}*|tenemos|tengo|llevamos|viaje|en vez)(?![\p{L}])/iu],
  ["en", /(?<![\p{L}])(?:by car|by road|road ?trip|car|cars|drive|driving|whole|instead)(?![\p{L}])/iu],
];

/** The language to answer a car ask in: its own words', or else the page's. */
export function askLanguage(message: string, fallback: SupportedLanguage): SupportedLanguage {
  return ASK_LANGUAGE.find(([, words]) => words.test(message))?.[0] ?? fallback;
}

/** The longest message that is still only the car ask. */
const LONGEST_ASK = 160;

/**
 * Whether the message asks to go by car for the whole route: the way they travel, with no day and no city of the
 * route named, and not weighed up ("is it better to drive?").
 */
export function asksToDriveTheRoute(message: string, days: ItineraryDay[]): boolean {
  const text = message.trim();
  if (!text || text.length > LONGEST_ASK) return false;
  if (NO_CAR.test(text) || WEIGHING.test(text) || dayMentioned(text) !== undefined) return false;
  // Trains or ferries wanted beside the car is more than the car: the model weighs which hops keep them.
  if (OTHER_WAYS.test(text) && !SWAP.test(text) && !RIDES_TO_CAR.test(text)) return false;
  if (!(CAR_WAY.test(text) || RIDES_TO_CAR.test(text) || (DRIVING.test(text) && WHOLE_OR_INSTEAD.test(text)))) return false;
  const said = ` ${plain(text).replace(/[^\p{L}\p{N}]+/gu, " ")} `;
  const cities = new Set(days.map((d) => (d.city ? cityKey(d.city) : "")).filter(Boolean));
  return ![...cities].some((city) => said.includes(` ${city} `));
}

/** A road is about this much longer than the straight line, driven at this average. */
const ROAD_FACTOR = 1.3;
const ROAD_KMH = 100;
/** The longest drive put in a day; a longer one keeps its ride. */
const LONGEST_DRIVE_MINUTES = 12 * 60;
/** Nearer than this, the hop is no drive worth a stop of its own. */
const NEAREST_KM = 15;

type Box = { lat: [number, number]; lng: [number, number] };
/**
 * Where a flight can be driven instead, both ends in the same box: Europe, Japan, Korea, Taiwan, North America
 * above the Caribbean, and mainland Australia. Elsewhere a flight is often over the sea, which no point can tell.
 */
const ROAD_LANDS: Box[] = [
  { lat: [35, 71.5], lng: [-10.5, 40] },
  { lat: [30, 46], lng: [128, 146] },
  { lat: [33, 39], lng: [124, 131] },
  { lat: [21.8, 25.4], lng: [119.9, 122.1] },
  { lat: [24, 60], lng: [-130, -52] },
  { lat: [-39, -10], lng: [113, 154] },
];
const inBox = (p: { lat: number; lng: number }, b: Box) =>
  p.lat >= b.lat[0] && p.lat <= b.lat[1] && p.lng >= b.lng[0] && p.lng <= b.lng[1];
const landOf = (p: { lat: number; lng: number }) => ROAD_LANDS.findIndex((b) => inBox(p, b));

type Mode = "train" | "bus" | "flight" | "ferry" | "ground";
/** A ride the plan keeps, and why: no road makes it, the drive is too long, or the traveller fixed it. */
export interface KeptRide {
  from: string;
  to: string;
  mode: Mode;
  why: "no_road" | "too_long" | "fixed";
  driveMinutes?: number;
}
export interface Drive {
  from: string;
  to: string;
  minutes: number;
}

type Words = {
  name: (to: string) => string;
  description: (from: string, to: string) => string;
  drives: (list: string) => string;
  hop: (from: string, to: string, time: string) => string;
  leaves: string;
  noRoad: (mode: Mode, from: string, to: string) => string;
  tooLong: (mode: Mode, from: string, to: string, time: string) => string;
  fixed: (mode: Mode, from: string, to: string) => string;
  left: (names: string) => string;
};

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const IT_RIDE: Record<Mode, string> = { train: "il treno", bus: "l'autobus", flight: "il volo", ferry: "il traghetto", ground: "il trasferimento" };
const PT_RIDE: Record<Mode, string> = { train: "o trem", bus: "o ônibus", flight: "o voo", ferry: "o barco", ground: "o traslado" };
const ES_RIDE: Record<Mode, string> = { train: "el tren", bus: "el autobús", flight: "el vuelo", ferry: "el barco", ground: "el traslado" };
const EN_RIDE: Record<Mode, string> = { train: "the train", bus: "the bus", flight: "the flight", ferry: "the ferry", ground: "the transfer" };

const WORDS: Record<SupportedLanguage, Words> = {
  en: {
    name: (to) => `Drive to ${to}`,
    description: (from, to) => `Driving from ${from} to ${to}: the time is an estimate from the distance.`,
    drives: (list) => `Here are the rides between your cities as drives: ${list}.`,
    hop: (from, to, time) => `${from} to ${to}, about ${time}`,
    leaves: "Each leaves at 08:30, and its time is an estimate from the distance.",
    noRoad: (mode, from, to) => `${capital(EN_RIDE[mode])} from ${from} to ${to} stays: I can't plan that one by road.`,
    tooLong: (mode, from, to, time) => `${capital(EN_RIDE[mode])} from ${from} to ${to} stays: driving it takes about ${time}.`,
    fixed: (mode, from, to) => `${capital(EN_RIDE[mode])} from ${from} to ${to} stays: it's one of your fixed plans.`,
    left: (names) => `To fit the drive, these come off their day: ${names}.`,
  },
  es: {
    name: (to) => `En coche a ${to}`,
    description: (from, to) => `En coche de ${from} a ${to}: la duración es una estimación por la distancia.`,
    drives: (list) => `Aquí tienes los trayectos entre tus ciudades en coche: ${list}.`,
    hop: (from, to, time) => `de ${from} a ${to}, unas ${time}`,
    leaves: "Cada uno sale a las 08:30, y su duración es una estimación por la distancia.",
    noRoad: (mode, from, to) => `${capital(ES_RIDE[mode])} de ${from} a ${to} se queda: no puedo planearlo por carretera.`,
    tooLong: (mode, from, to, time) => `${capital(ES_RIDE[mode])} de ${from} a ${to} se queda: en coche son unas ${time}.`,
    fixed: (mode, from, to) => `${capital(ES_RIDE[mode])} de ${from} a ${to} se queda: es uno de tus planes fijos.`,
    left: (names) => `Para que quepa el trayecto, salen de su día: ${names}.`,
  },
  it: {
    name: (to) => `In auto a ${to}`,
    description: (from, to) => `In auto da ${from} a ${to}: la durata è una stima dalla distanza.`,
    drives: (list) => `Ecco gli spostamenti tra le tue città in auto: ${list}.`,
    hop: (from, to, time) => `da ${from} a ${to}, circa ${time}`,
    leaves: "Ognuno parte alle 08:30, e la durata è una stima dalla distanza.",
    noRoad: (mode, from, to) => `${capital(IT_RIDE[mode])} da ${from} a ${to} resta: non posso pianificarlo su strada.`,
    tooLong: (mode, from, to, time) => `${capital(IT_RIDE[mode])} da ${from} a ${to} resta: in auto ci vogliono circa ${time}.`,
    fixed: (mode, from, to) => `${capital(IT_RIDE[mode])} da ${from} a ${to} resta: è uno dei tuoi piani fissi.`,
    left: (names) => `Per far posto al viaggio in auto, escono dal loro giorno: ${names}.`,
  },
  pt: {
    name: (to) => `De carro para ${to}`,
    description: (from, to) => `De carro de ${from} para ${to}: o tempo é uma estimativa pela distância.`,
    drives: (list) => `Aqui estão os trajetos entre suas cidades de carro: ${list}.`,
    hop: (from, to, time) => `de ${from} para ${to}, cerca de ${time}`,
    leaves: "Cada um sai às 08:30, e o tempo é uma estimativa pela distância.",
    noRoad: (mode, from, to) => `${capital(PT_RIDE[mode])} de ${from} para ${to} fica: não consigo planejar esse trecho de carro.`,
    tooLong: (mode, from, to, time) => `${capital(PT_RIDE[mode])} de ${from} para ${to} fica: de carro são cerca de ${time}.`,
    fixed: (mode, from, to) => `${capital(PT_RIDE[mode])} de ${from} para ${to} fica: é um dos seus planos fixos.`,
    left: (names) => `Para caber a viagem de carro, saem do dia: ${names}.`,
  },
};

const RIDE_MODES = new Set<string>(["train", "bus", "flight", "ferry", "ground"]);
const isRide = (a: Activity): a is Activity & { transport_mode: Mode } =>
  a.type === "transport" && RIDE_MODES.has((a as { transport_mode?: string }).transport_mode ?? "");

/** The run of days in `city` that holds day `index`, going back (-1) or forward (+1) from it. */
function stretch(days: ItineraryDay[], index: number, step: 1 | -1): ItineraryDay[] {
  const key = cityKey(days[index].city ?? "");
  const run: ItineraryDay[] = [];
  for (let i = index; i >= 0 && i < days.length && cityKey(days[i].city ?? "") === key; i += step) run.push(days[i]);
  return run;
}

/**
 * The route's rides as drives: an edit for each day that reaches a new city by train, bus, flight or a transfer of no
 * named way, with a drive
 * in its place, measured from the two cities' places, and the day fitted around its arrival (arrivalDay). The rides
 * that stay, and the reply in the traveller's language.
 */
export function driveTheRoute(
  days: ItineraryDay[],
  opts: { currency: string; language: SupportedLanguage },
): { edits: DayEdit[]; drives: Drive[]; kept: KeptRide[]; reply: string } {
  const words = WORDS[opts.language];
  const ordered = [...days].sort((a, b) => a.day_number - b.day_number);
  const edits: DayEdit[] = [];
  const drives: Drive[] = [];
  const kept: KeptRide[] = [];
  const left: string[] = [];
  for (let i = 1; i < ordered.length; i++) {
    const day = ordered[i];
    const before = ordered[i - 1];
    if (!day.city || !before.city || cityKey(day.city) === cityKey(before.city)) continue;
    const ride = (day.activities ?? []).find(isRide);
    if (!ride) continue;
    const from = before.city.split(",")[0].trim();
    const to = day.city.split(",")[0].trim();
    const mode = ride.transport_mode;
    if (isLockedActivity(ride)) {
      kept.push({ from, to, mode, why: "fixed" });
      continue;
    }
    const a = middleOf(stretch(ordered, i - 1, -1));
    const b = middleOf(stretch(ordered, i, 1));
    if (!a || !b) continue;
    const km = haversineKm(a, b);
    if (km < NEAREST_KM) continue;
    const land = landOf(a);
    const roadLand = land !== -1 && land === landOf(b);
    // A transfer of no named way where a drive isn't measured (it may be by sea): as the plan has it.
    if (mode === "ground" && !roadLand) continue;
    if (mode === "ferry" || !onSameLand(a, b) || (mode === "flight" && !roadLand)) {
      kept.push({ from, to, mode, why: "no_road" });
      continue;
    }
    const minutes = Math.round((km * ROAD_FACTOR) / ROAD_KMH * 12) * 5;
    if (minutes > LONGEST_DRIVE_MINUTES) {
      kept.push({ from, to, mode, why: "too_long", driveMinutes: minutes });
      continue;
    }
    const built = buildTransferActivity({
      fromCity: from,
      toCity: to,
      fromDays: stretch(ordered, i - 1, -1),
      toDays: stretch(ordered, i, 1),
      currency: opts.currency,
      language: opts.language,
      known: { mode: "car", minutes },
    });
    const drive = {
      ...built,
      name: words.name(to),
      description: words.description(from, to),
      booking_required: false,
    } as Activity;
    const rest = (day.activities ?? []).filter((x) => x !== ride);
    const fitted = arrivalDay(drive, rest);
    // A fixed plan of the day that the drive would move or take out: the ride stays.
    const movedFixed = rest.some((x) => isLockedActivity(x) && (!fitted.activities.includes(x) || fitted.left.includes(x)));
    if (movedFixed) {
      kept.push({ from, to, mode, why: "fixed" });
      continue;
    }
    left.push(...fitted.left.map((x) => x.name).filter(Boolean));
    drives.push({ from, to, minutes: drive.duration_minutes ?? minutes });
    edits.push({ day_number: day.day_number, summary: drive.name, activities: fitted.activities, city: day.city });
  }
  const lines: string[] = [];
  if (drives.length > 0) {
    lines.push(words.drives(drives.map((d) => words.hop(d.from, d.to, formatDuration(d.minutes))).join("; ")), words.leaves);
  }
  for (const k of kept) {
    if (k.why === "no_road") lines.push(words.noRoad(k.mode, k.from, k.to));
    else if (k.why === "too_long") lines.push(words.tooLong(k.mode, k.from, k.to, formatDuration(k.driveMinutes ?? 0)));
    else lines.push(words.fixed(k.mode, k.from, k.to));
  }
  if (left.length > 0) lines.push(words.left(left.join(", ")));
  return { edits, drives, kept, reply: lines.join(" ") };
}
