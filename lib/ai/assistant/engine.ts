/**
 * The assistant's edit engine: answers a question about a plan, or proposes
 * revised days for it, in one model call. It writes nothing; each caller shows
 * the revised days and applies them on the traveller's confirm. Used by the
 * wizard's assistant (app/api/ai/assistant-anon, signed out or in, saved or
 * not) and the trip page's assistant (lib/ai/assistant/trip-edits.ts).
 *
 * One reply may change several days and the trip's length. The normalizer
 * guarantees every revised activity has the fields the views need, so a
 * partial model response never breaks the render.
 */

import {
  GoogleGenerativeAI,
  type GenerateContentResult,
  type GenerationConfig,
} from "@/lib/ai/genai-compat";
import { logCacheMetrics } from "@/lib/ai/cache-metrics";
import { getModelForPurpose, getSiblingModel, thinkingConfigFor } from "@/lib/ai/model-router";
import { geminiCostUsd } from "@/lib/ai/gemini-cost";
import { isLockedActivity } from "@/lib/ai/anchors-core";
import {
  announcedButMissing,
  announcesProposal,
  asksToRemove,
  claimsItineraryChange,
  claimsLongerTrip,
  isConfirmation,
  statedDayCounts,
  offersChange,
} from "@/lib/ai/assistant/honesty";
import { planCosts, planCurrency } from "@/lib/ai/assistant/plan-costs";
import { dayMentioned } from "@/lib/ai/assistant/day-target";
import { currencyRequested } from "@/lib/ai/assistant/currency-request";
import { readElsewhere, type TripPlace } from "@/lib/ai/assistant/elsewhere";
import type { ItineraryDay } from "@/types";
import {
  type AssistInput,
  canOfferElsewhere,
  buildPrompt,
  MAX_DAYS_PER_REPLY,
  tripLengthLine,
  tripSpan,
} from "./edit-prompt";
import { type DayEdit, validateEdits, plainText, str, num } from "./edit-validation";
import { keepSavedActivities, takenOut } from "./saved-activities";
import {
  asksForFreeDay,
  tellsWhereTheyStay,
  CHECK_IN,
  TELLS_TIME,
  asksForMoreDays,
  asksForFewerDays,
  asksToAdd,
  keepsEverything,
  listedPlaces,
  talksAboutDayCount,
} from "./message-asks";
import { type TravelTime, readTravelTimes, outsideTravelTimes, minutesOf } from "./travel-times";
import { composeReply } from "./edit-reply";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || "");
/** A change about more days asks for the rest at once, if it can start by now… */
const MORE_DAYS_START_MS = 32_000;
/** …and stops waiting for them here, inside the route's 60 s. */
const MORE_DAYS_DEADLINE_MS = 52_000;
/** A list still short asks once more for its missing places, if it can start by now. */
const FILL_START_MS = 36_000;
/** Tokens the model may think for before answering (see assistTrip). */
const THINKING_BUDGET = 1024;
/** Later than this, a reply that needs correcting stands: the route has 60 s. */
const CORRECTION_DEADLINE_MS = 25_000;

export interface AssistResult {
  reply: string;
  /** Every day this reply changes (or adds), in day order. Empty for answers. */
  edits: DayEdit[];
  /** The trip's new total number of days, when the reply adds or removes days. */
  tripLength?: number;
  /** The currency the planner asked prices in; the page switches its preference to it. */
  currency?: string;
  /** Places offered for the whole trip, when the traveller asked to go somewhere else. */
  elsewhere?: TripPlace[];
  meta: { model: string; costUsd: number; generationTimeMs: number };
}

type Outcome = ReturnType<typeof validateEdits> & {
  reply: string;
  moreDays: number[];
  travelTimes: TravelTime[];
  /** Places offered for the whole trip; only with no change prepared. */
  elsewhere: TripPlace[];
};

/** The model's JSON, as the reply and checked edits this engine works with. */
function readOutcome(input: AssistInput, obj: Record<string, unknown>, cur: string): Outcome {
  const reply = plainText(str(obj.reply, "").trim());
  // "edits" (current shape) or "edit" (the single-day shape, still accepted).
  const rawEdits = Array.isArray(obj.edits) ? obj.edits : obj.edit && typeof obj.edit === "object" ? [obj.edit] : [];
  const checked = validateEdits(
    input.days,
    { edits: rawEdits, tripLength: obj.trip_length, moreDays: obj.more_days },
    cur,
    asksForFreeDay(input.message),
  );
  const edits = keepSavedActivities(input.days, checked.edits, { reply, message: input.message });
  // The other days the change concerns, past what one reply holds.
  const length = checked.tripLength ?? input.days.length;
  const done = new Set(edits.map((e) => e.day_number));
  const moreDays = [...new Set((Array.isArray(obj.more_days) ? obj.more_days : []).map((n) => Math.round(num(n, 0))))]
    .filter((n) => n >= 1 && n <= length && !done.has(n))
    .sort((a, b) => a - b);
  const elsewhere =
    canOfferElsewhere(input) && edits.length === 0 && checked.tripLength === undefined
      ? readElsewhere(obj.elsewhere, input.destination)
      : [];
  return { ...checked, edits, reply, moreDays, travelTimes: readTravelTimes(obj.travel_times, length), elsewhere };
}

/**
 * The days with these edits made, new days added at the end, for the next
 * part of a change and its costs.
 */
function withEdits(days: ItineraryDay[], edits: DayEdit[]): ItineraryDay[] {
  const byDay = new Map(edits.map((e) => [e.day_number, e]));
  const added = edits
    .filter((e) => e.day_number > days.length)
    .map((e): ItineraryDay => ({ day_number: e.day_number, date: "", theme: e.theme, activities: e.activities, ...(e.city ? { city: e.city } : {}) }));
  return [
    ...days.map((d) => {
      const e = byDay.get(d.day_number);
      return e ? { ...d, theme: e.theme ?? d.theme, activities: e.activities } : d;
    }),
    ...added,
  ];
}

/** Does the edit leave its day as it was (same activities at the same times)? */
function leavesDayAsItWas(days: ItineraryDay[], e: DayEdit): boolean {
  const old = days.find((d) => d.day_number === e.day_number)?.activities ?? [];
  return old.length === e.activities.length && old.every((a, i) => a?.name === e.activities[i].name && a?.start_time === e.activities[i].start_time);
}

/** Does the edit keep its day's activities, whatever their times? */
function keepsDayStops(days: ItineraryDay[], e: DayEdit): boolean {
  const names = (list: Array<{ name?: unknown } | null | undefined>) =>
    list.map((a) => (typeof a?.name === "string" ? a.name.trim().toLowerCase() : "")).sort().join("\n");
  return names(days.find((d) => d.day_number === e.day_number)?.activities ?? []) === names(e.activities);
}

/** What the last ask for a list's missing places says. */
function fillPrompt(missing: string[], keepAll: boolean): string {
  return `CONTINUE: these places from their list aren't in the plan yet: ${missing.join(", ")}. Return in "edits" only the days you add them to, each day in full: add each place once, on the day and at the time it fits best (a restaurant at lunch or dinner), keeping every activity the day already has${keepAll ? "" : " unless it truly can't fit"}. "more_days" is [], "trip_length" is null, and "reply" is one short line.`;
}

/**
 * What the next part of a change is asked with; `length` when the trip gets
 * longer, `keepAll` when they said to keep everything already planned.
 */
function continuePrompt(reply: string, done: number[], group: number[], current: number, length?: number, keepAll = false): string {
  const fresh = length !== undefined ? group.filter((n) => n > current) : [];
  const newDays =
    fresh.length > 0
      ? ` Days ${fresh.join(", ")} are new days at the end of the trip, which now has ${length} days: plan each in full, carrying on from the day before and repeating nothing the trip already holds.`
      : "";
  const keep = keepAll ? " They asked you to keep everything already planned: keep every activity these days have, and add alongside." : "";
  return `CONTINUE: you are partway through this change. Your reply was: "${reply.slice(0, 600)}". Days ${done.join(", ")} are done, and the itinerary above shows them. Now return Days ${group.join(", ")} in "edits", each in full, changed the same way, and no other day. Each thing they asked to add goes on one day only: add nothing the itinerary above already holds, and leave out of "edits" a day this change doesn't need.${keep}${newDays} "more_days" is [], "trip_length" is ${length ?? "null"}, and "reply" is one short line.`;
}

const placeName = (s: string) =>
  ` ${s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
/** How many letters to add, drop or change to turn one name into the other. */
function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length];
}

/**
 * The same place by name: "Madalosso" and "Madalosso Restaurante", or a letter
 * off in a longer name, as the model sometimes writes one ("Let's Road" for
 * "Lett's Road"); a short one like "Bar Basso" has to match.
 */
const samePlace = (a: string, b: string) => {
  const x = placeName(a).trim();
  const y = placeName(b).trim();
  if (x.length < 6 || y.length < 6) return false;
  if (` ${x} `.includes(` ${y} `) || ` ${y} `.includes(` ${x} `)) return true;
  const shorter = Math.min(x.length, y.length);
  return shorter >= 10 && editDistance(x, y) <= (shorter >= 16 ? 2 : 1);
};

/** The places listed in the message or the traveller's last messages. */
function listedInTalk(input: Pick<AssistInput, "message" | "history">): string[] {
  return [input.message, ...(input.history ?? []).slice(-4).filter((t) => t.role === "user").map((t) => t.text)].flatMap(listedPlaces);
}

/**
 * A place of the traveller's list goes on one day. Parts asked for later days
 * "the same way", two of them at once, placed the list again, and one reply
 * could repeat a place. Day by day, a listed place that the change or the plan
 * already holds on another day is left off, unless this day had it already. A
 * place added to every day ("breakfast at the hotel each day") isn't listed, and
 * stays. Pure; unit-tested through assistTrip.
 */
function listedOnce(days: ItineraryDay[], listed: string[], edits: DayEdit[]): DayEdit[] {
  if (listed.length === 0) return edits;
  const names = (list: Array<{ name?: unknown } | null | undefined>) => list.map((a) => (typeof a?.name === "string" ? a.name : ""));
  const ownOf = (n: number) => names(days.find((d) => d.day_number === n)?.activities ?? []);
  // What a day keeps of its own whatever happens: it had it already.
  const keepsOwn = (e: DayEdit) => names(e.activities).filter((a) => ownOf(e.day_number).some((n) => samePlace(n, a)));
  const sorted = [...edits].sort((a, b) => a.day_number - b.day_number);
  const done: string[] = [];
  return sorted.map((e) => {
    const own = ownOf(e.day_number);
    // Where it already is: an earlier changed day as kept, a later one's own, or a day left as it was.
    const elsewhere = [
      ...done,
      ...sorted.filter((x) => x.day_number > e.day_number).flatMap(keepsOwn),
      ...days.filter((d) => !sorted.some((x) => x.day_number === d.day_number)).flatMap((d) => names(d.activities ?? [])),
    ];
    const kept = {
      ...e,
      activities: e.activities.filter(
        (a) => own.some((n) => samePlace(n, a.name)) || !listed.some((p) => samePlace(p, a.name)) || !elsewhere.some((n) => samePlace(n, a.name)),
      ),
    };
    done.push(...names(kept.activities));
    return kept;
  });
}

/**
 * The places of a list they asked to add that neither the change nor the plan
 * holds: ten restaurants came back as eight, with a reply naming all ten. Only
 * for a list most of whose places did come back, so a list of kinds ("museums,
 * parks and markets") is left alone. Pure; unit-tested.
 */
export function missingFromList(input: Pick<AssistInput, "message" | "history" | "days">, edits: DayEdit[]): string[] {
  const listed = listedPlaces(input.message);
  if (listed.length < 3) return [];
  const told = [input.message, ...(input.history ?? []).slice(-4).filter((t) => t.role === "user").map((t) => t.text)].join("\n");
  if (!asksToAdd(told) && !keepsEverything(told)) return [];
  const names = [...input.days.flatMap((d) => (d.activities ?? []).map((a) => a?.name ?? "")), ...edits.flatMap((e) => e.activities.map((a) => a.name))];
  const missing = listed.filter((p) => !names.some((n) => samePlace(n, p)));
  return missing.length > 0 && listed.length - missing.length >= Math.ceil(listed.length / 2) ? missing : [];
}

/** The promise's value, or a rejection once `ms` have passed. */
function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("assistant-anon: out of time")), Math.max(0, ms));
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/**
 * A shorter trip they didn't ask for: "count, it's 8" argues the count and asks
 * for nothing. A yes to an offer of fewer days asks for it.
 */
function cutUnasked(input: Pick<AssistInput, "message" | "history" | "days">, tripLength: number | undefined): boolean {
  if (tripLength === undefined || tripLength >= input.days.length) return false;
  const last = input.history?.at(-1);
  const offered = isConfirmation(input.message) && last?.role === "assistant" && asksForFewerDays(last.text);
  return !asksForFewerDays(input.message) && !offered;
}

/** A reply about how long the trip is that gives it another number of days than it has. */
function countsWrong(input: Pick<AssistInput, "message" | "days">, reply: string, tripLength: number | undefined): boolean {
  return talksAboutDayCount(input.message) && statedDayCounts(reply).some((n) => n !== (tripLength ?? input.days.length));
}

/** What a reply got wrong that one more try may fix, or null. Pure; unit-tested. */
export function correctionFor(
  input: Pick<AssistInput, "message" | "history" | "days" | "canAddDays" | "startDate">,
  o: Pick<Outcome, "reply" | "edits" | "tripLength"> & Partial<Pick<Outcome, "travelTimes" | "elsewhere" | "lengthRefused" | "moreDays" | "lockedDays">>,
  /** Hold the reply to a list of places they asked to add (on by default). */
  rules: { list?: boolean } = {},
): string | null {
  // Other places offered for the whole trip: there are no days to correct.
  if ((o.elsewhere?.length ?? 0) > 0) return null;
  const current = input.days.length;
  const prepared = o.edits.length > 0 || o.tripLength !== undefined;
  if (!prepared && announcesProposal(o.reply)) {
    return `Your "reply" hands over a change, but "edits" is empty. Put that change in "edits" now, or say plainly in "reply" that you couldn't make it.`;
  }
  const last = input.history?.at(-1);
  if (!prepared && isConfirmation(input.message) && last?.role === "assistant" && (offersChange(last.text) || announcesProposal(last.text))) {
    return `The traveller said yes to the change your last message offered. Make exactly that change now, in "edits".`;
  }
  if (!prepared && announcedButMissing(o.reply)) {
    return 'Your "reply" announced an answer without giving it. Put the whole answer in "reply" now.';
  }
  // A fixed plan the reply took out, moved or copied is back as it was
  // (validateEdits), and the rest of its day may not fit around it.
  const fixed = o.lockedDays?.[0];
  if (fixed) {
    const plans = (input.days.find((d) => d.day_number === fixed.dayNumber)?.activities ?? [])
      .filter(isLockedActivity)
      .map((a) => `${a.name} at ${a.start_time}`);
    return `Day ${fixed.dayNumber} has a fixed plan the traveller set: ${plans.join(", ")}. Return it exactly as it is, under its exact name and at its time, on Day ${fixed.dayNumber} only, and plan the rest of that day around it. If they asked to move, change or remove it, leave it as it is and say in "reply" that they can change it themselves in the plan; make the rest of what they asked.`;
  }
  const day = dayMentioned(input.message);
  if (day && day <= current && o.edits.length > 0 && !o.edits.some((e) => e.day_number === day)) {
    return `The traveller named Day ${day}. Make the change on Day ${day}, keeping its other activities unless they can't fit. If Day ${day} really can't work, change nothing and say why in "reply", suggesting another day.`;
  }
  if (tellsWhereTheyStay(input.message) && !o.edits.some((e) => e.activities.some((a) => CHECK_IN.test(a.name)))) {
    return `The traveller told you where they are staying. Add a short "Check in at <place>" activity on the first day of that stay (evening, or after their arrival), keeping everything else.`;
  }
  // The days this reply changes, and every day when the message gives a time:
  // that is when the plan must first be fitted to it.
  const timed = TELLS_TIME.test(input.message) ? withEdits(input.days, o.edits) : o.edits;
  const outside = outsideTravelTimes(timed, o.travelTimes ?? [])[0];
  if (outside) {
    const late = outside.from !== null && minutesOf(outside.from) >= 22 * 60;
    const when = [
      outside.arrives &&
        (late
          ? `they arrive at ${outside.arrives}, too late for anything but getting to where they stay`
          : `they arrive at ${outside.arrives}, so plan nothing before ${outside.from}`),
      outside.leaves && `they leave at ${outside.leaves}, so everything must end by ${outside.until}`,
    ]
      .filter(Boolean)
      .join(", and ");
    return `Day ${outside.day}: ${when}. ${outside.names.join(", ")} ${outside.names.length > 1 ? "don't" : "doesn't"} fit. Move what matters to a day with room, or leave it out, and say so in "reply".`;
  }
  const recent = [input.message, ...(input.history ?? []).slice(-2).map((t) => t.text)].join("\n");
  if (o.tripLength !== undefined && o.tripLength > current && !asksForMoreDays(recent, current)) {
    return `Keep the trip at ${current} days: fit the change into the existing days and say in "reply" what it replaces. Add days only when the traveller asks.`;
  }
  // How long the trip is comes from its dates: "isn't 28 Nov to 6 Dec 8 days?"
  // got "You're totally right!", and "count, it's 8" a day cut from the trip.
  const cut = cutUnasked(input, o.tripLength);
  if (cut || countsWrong(input, o.reply, o.tripLength)) {
    const wrong = cut ? "Your edits make the trip shorter, which they didn't ask for." : 'Your "reply" gives it another number of days.';
    return `${tripLengthLine(input.days, input.startDate)} ${wrong} Keep every day and give this count. If they count it differently, say kindly that ${current} days are ${current - 1} nights, day by day with the dates if they ask. Add or remove days only when they ask for that.`;
  }
  if (o.tripLength === undefined && input.canAddDays !== false && asksForMoreDays(recent, current) && (o.lengthRefused || claimsLongerTrip(o.reply))) {
    return `The longer trip didn't come back whole. The trip has ${current} days. Set "trip_length" to the new total, and return every day from the first new one to the new last day, in "edits" or listed in "more_days": new days in the middle of the trip move the later days along. If you can't, change nothing and say why in "reply".`;
  }
  if (o.edits.length > 0 && o.tripLength === undefined && o.edits.every((e) => leavesDayAsItWas(input.days, e))) {
    return `Your edits left every day as it was. Make the change the traveller asked for, or say plainly in "reply" that you didn't.`;
  }
  // Told to keep everything planned ("não remova nada"), now or in their last
  // messages, a day lost activities; or asked only to add, it lost one or two
  // (a whole day swapped for a day trip is the expected way to fit one in).
  const dropped = takenOut(input.days, o.edits);
  const told = [input.message, ...(input.history ?? []).slice(-4).filter((t) => t.role === "user").map((t) => t.text)].join("\n");
  if (dropped.length > 0 && !asksToRemove(input.message) && keepsEverything(told)) {
    return `They asked you to keep everything already planned. Keep ${dropped.join(" and ")} and add alongside: a day can hold more activities, so move times rather than take anything out.`;
  }
  if (asksToAdd(input.message) && !asksToRemove(input.message) && dropped.length > 0 && dropped.length <= 2) {
    return `They asked only to add. Keep ${dropped.join(" and ")} and add the new activity alongside, moving times if needed. Take something out only if the day truly can't fit it, and then say which in "reply".`;
  }
  // A list of places to add came back short, with no other days to come.
  const missing = rules.list !== false && (o.moreDays?.length ?? 0) === 0 ? missingFromList(input, o.edits) : [];
  if (missing.length > 0) {
    return `These places from their list aren't in your edits: ${missing.join(", ")}. Add each one once, on a day where it fits, keeping everything else, or say in "reply" which can't fit and why.`;
  }
  // A saved activity (its name is kept, see keepSavedActivities) added to a
  // day while the one day that has it is left as it was. A name on several
  // saved days ("Breakfast at the hotel") recurs on purpose.
  const key = (x?: string) => (x ?? "").trim().toLowerCase();
  const edited = new Set(o.edits.map((e) => e.day_number));
  for (const e of o.edits) {
    for (const a of e.activities) {
      const name = key(a.name);
      if (!name) continue;
      const holders = input.days.filter((d) => (d.activities ?? []).some((b) => key(b?.name) === name));
      if (holders.length === 1 && !edited.has(holders[0].day_number)) {
        const twin = holders[0].day_number;
        return `${a.name} is already on Day ${twin}. To have it on Day ${e.day_number}, move it: also return Day ${twin} without it. Otherwise leave it where it is and say so in "reply".`;
      }
    }
  }
  // Said to be made, with nothing sent: "I've added…" and an empty "edits". A
  // currency request is the page's to answer, with no edits.
  if (!prepared && claimsItineraryChange(o.reply) && !currencyRequested(input.message)) {
    return `Your "reply" says the plan changes, but "edits" is empty. Put that change in "edits" now, or say plainly in "reply" that you couldn't make it.`;
  }
  return null;
}

/**
 * Whether a second try that still breaks a rule beats a first reply that
 * prepared nothing, which the traveller would read as "I couldn't make that
 * change". It does when it changes the day they named, keeps the trip's length
 * and wasn't asked for more days: like any change, it is shown before it's
 * saved or can be undone, with what it takes out named. Pure; unit-tested.
 */
export function betterThanNothing(
  input: Pick<AssistInput, "message" | "history" | "days">,
  first: Pick<Outcome, "edits" | "tripLength">,
  retried: Pick<Outcome, "edits" | "tripLength">,
): boolean {
  if (first.edits.length > 0 || first.tripLength !== undefined) return false;
  if (retried.edits.length === 0 || retried.tripLength !== undefined) return false;
  const recent = [input.message, ...(input.history ?? []).slice(-2).map((t) => t.text)].join("\n");
  if (asksForMoreDays(recent, input.days.length)) return false;
  const day = dayMentioned(input.message);
  if (day && !retried.edits.some((e) => e.day_number === day)) return false;
  return !retried.edits.every((e) => leavesDayAsItWas(input.days, e));
}

/** 429, 500 and 503 ("high demand") are the model pool's, not the request's. */
export function isModelOverloaded(err: unknown): boolean {
  const status = (err as { status?: unknown } | null)?.status;
  return status === 429 || status === 500 || status === 503;
}

/**
 * Answer or propose edits. Throws on missing key / empty output — the route
 * maps those to a 500. Input validation is the route's job.
 */
export async function assistTrip(input: AssistInput): Promise<AssistResult> {
  if (!process.env.GOOGLE_AI_API_KEY) {
    throw new Error("GOOGLE_AI_API_KEY not configured");
  }
  const startedAt = Date.now();
  const cur = planCurrency(input.days);
  let modelId = getModelForPurpose("assistant-edits");

  const generationConfig: GenerationConfig = {
    temperature: 0.3,
    responseMimeType: "application/json",
    // Several full days of 3-5 activity objects, plus the reply. 4096 fits
    // one day: "add one more day" would be cut off into non-JSON.
    // Thinking counts against this cap, hence the budget on top of the reply.
    maxOutputTokens: 8192 + THINKING_BUDGET,
    // A small, fixed thinking budget. With none, multi-part and whole-trip
    // requests came back half done; unbounded, thinking ate the output cap
    // and the replies arrived truncated or slow.
    thinkingConfig: thinkingConfigFor(modelId, THINKING_BUDGET),
  };
  let costUsd = 0;

  // One retry on non-JSON output: flash-tier models occasionally emit prose or
  // truncated JSON despite responseMimeType. Re-asking breaks the repro loop
  // cheaply and keeps the assistant from 500ing into the generic "Couldn't do
  // that" toast that session replays show users hammering (replay 019f24bf).
  // An overloaded model gets the same single retry, on its sibling: overload
  // errors belong to one model's serving pool.
  const ask = async (prompt: string, attempts = 2): Promise<Record<string, unknown>> => {
    let model = genAI.getGenerativeModel({ model: modelId, generationConfig });
    let parsed: unknown | undefined;
    for (let attempt = 0; attempt < attempts && parsed === undefined; attempt++) {
      let response: GenerateContentResult;
      try {
        response = await model.generateContent({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
        });
      } catch (err) {
        if (attempt === attempts - 1 || !isModelOverloaded(err)) throw err;
        console.warn(`assistant-anon: ${modelId} overloaded, retrying on its sibling`);
        modelId = getSiblingModel(modelId);
        model = genAI.getGenerativeModel({
          model: modelId,
          generationConfig: { ...generationConfig, thinkingConfig: thinkingConfigFor(modelId, THINKING_BUDGET) },
        });
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
      logCacheMetrics("ai.assistant-anon", response.response.usageMetadata, modelId);
      costUsd += geminiCostUsd(modelId, response.response.usageMetadata);
      try {
        parsed = JSON.parse(response.response.text());
      } catch {
        // MAX_TOKENS means the cap was hit (the thinking-budget failure mode);
        // STOP means the model really did answer in prose. Logged so the two
        // are told apart from the logs rather than guessed.
        console.warn(
          `assistant-anon: non-JSON output (attempt ${attempt + 1}), finishReason:`,
          response.response.candidates?.[0]?.finishReason ?? "unknown"
        );
        if (attempt === attempts - 1) {
          throw new Error("assistant-anon: model returned non-JSON output");
        }
      }
    }
    return (parsed ?? {}) as Record<string, unknown>;
  };

  // A reply that breaks a rule the model was given (another day than the one
  // named, a longer trip nobody asked for, an answer announced and not given)
  // gets one more try with the rule spelled out, while there's time for one.
  // The first reply stands when the second fails or is no better.
  const prompt = buildPrompt(input);
  let outcome = readOutcome(input, await ask(prompt), cur);
  const correction = correctionFor(input, outcome);
  if (correction && Date.now() - startedAt < CORRECTION_DEADLINE_MS) {
    try {
      const retried = readOutcome(input, await ask(`${prompt}\n\nCORRECTION: ${correction}`, 1), cur);
      // Held to the first reply's travel times too, in case it drops them.
      const times = [...retried.travelTimes, ...outcome.travelTimes];
      const fixed = { ...retried, travelTimes: times };
      // A list that comes back with more of its places is better, if nothing else is broken.
      const moreOfList =
        missingFromList(input, retried.edits).length < missingFromList(input, outcome.edits).length &&
        !correctionFor(input, fixed, { list: false });
      if (!correctionFor(input, fixed) || betterThanNothing(input, outcome, retried) || moreOfList) outcome = retried;
    } catch (err) {
      console.warn("assistant-anon: correction failed, keeping the first reply:", err instanceof Error ? err.message : err);
    }
  }
  const { reply, lockedDays } = outcome;
  let { tripLength, lengthRefused } = outcome;
  let edits = outcome.edits;
  const current = input.days.length;
  // A shorter trip nobody asked for keeps every day, and nothing of that reply stands.
  const keptLength = cutUnasked(input, tripLength);
  if (keptLength) {
    tripLength = undefined;
    edits = [];
  }
  // The new days of a longer trip.
  const added =
    tripLength !== undefined && tripLength > current
      ? Array.from({ length: tripLength - current }, (_, i) => current + 1 + i)
      : [];

  // A change about more days than one reply holds: the first reply names the
  // other days ("more_days"), a longer trip's new days too ("aggiungi altri 7
  // giorni" could not be done in one reply). They are asked for together, the
  // same way, and the days of a part that doesn't come back in time are named
  // in the reply.
  let daysLeft = keptLength ? [] : outcome.moreDays;
  // A change of what the days hold (places added or taken out): a part's day
  // that only moved times isn't part of it. A change of times keeps those.
  const changesStops = edits.some((e) => !keepsDayStops(input.days, e));
  const fromParts = new Set<number>();
  // Told to keep everything planned ("não remova nada"), now or in their last messages.
  const keepAll =
    keepsEverything([input.message, ...(input.history ?? []).slice(-4).filter((t) => t.role === "user").map((t) => t.text)].join("\n")) &&
    !asksToRemove(input.message);
  if (daysLeft.length > 0 && Date.now() - startedAt < MORE_DAYS_START_MS) {
    const sofar = withEdits(input.days, edits);
    const done = edits.map((e) => e.day_number);
    const groups = Array.from({ length: Math.ceil(daysLeft.length / MAX_DAYS_PER_REPLY) }, (_, i) =>
      daysLeft.slice(i * MAX_DAYS_PER_REPLY, (i + 1) * MAX_DAYS_PER_REPLY),
    );
    const longer = added.length > 0 ? tripLength : undefined;
    const parts = await Promise.allSettled(
      groups.map((group) =>
        within(
          ask(`${buildPrompt({ ...input, days: sofar })}\n\n${continuePrompt(reply, done, group, current, longer, keepAll)}`, 1),
          MORE_DAYS_DEADLINE_MS - (Date.now() - startedAt),
        ),
      ),
    );
    const answered = new Set<number>();
    parts.forEach((part, i) => {
      if (part.status !== "fulfilled") return;
      const group = new Set(groups[i]);
      groups[i].forEach((n) => answered.add(n));
      // Read at the trip's new length, so the new days a part brings count.
      const more = readOutcome(input, { ...part.value, trip_length: tripLength ?? null, more_days: added }, cur).edits.filter((e) => group.has(e.day_number));
      more.forEach((e) => fromParts.add(e.day_number));
      edits = [...edits, ...more];
    });
    edits.sort((a, b) => a.day_number - b.day_number);
    daysLeft = daysLeft.filter((n) => !answered.has(n));
  }
  const settle = (list: DayEdit[]): DayEdit[] => {
    let kept = list;
    // Told to keep everything, a day that takes something out isn't part of the
    // change, whichever reply or part made it: what it added is named as missing.
    if (keepAll) {
      const gone = new Set(takenOut(input.days, kept).map((n) => n.trim().toLowerCase()));
      kept = kept.filter((e) => !(input.days.find((d) => d.day_number === e.day_number)?.activities ?? []).some((a) => gone.has((a?.name ?? "").trim().toLowerCase())));
    }
    // Each place of their list once, whichever reply or part placed it; then a
    // day left as it was, or a part's day that only moved times, isn't a change.
    return listedOnce(input.days, listedInTalk(input), kept).filter(
      (e) =>
        e.day_number > current ||
        (!leavesDayAsItWas(input.days, e) && !(fromParts.has(e.day_number) && changesStops && keepsDayStops(input.days, e))),
    );
  };
  edits = settle(edits);

  // A list still short once every part is in: one more ask for just its missing
  // places, on the plan as it now stands, while there's time. Kept only when it
  // brings more of the list.
  const short = daysLeft.length === 0 && tripLength === undefined ? missingFromList(input, edits) : [];
  if (short.length > 0 && Date.now() - startedAt < FILL_START_MS) {
    try {
      const now = withEdits(input.days, edits);
      const fill = readOutcome(
        input,
        await within(ask(`${buildPrompt({ ...input, days: now })}\n\n${fillPrompt(short, keepAll)}`, 1), MORE_DAYS_DEADLINE_MS - (Date.now() - startedAt)),
        cur,
      ).edits.filter((e) => e.day_number <= current);
      const byDay = new Map(edits.map((e) => [e.day_number, e]));
      fill.forEach((e) => {
        fromParts.add(e.day_number);
        byDay.set(e.day_number, e);
      });
      const filled = settle([...byDay.values()].sort((a, b) => a.day_number - b.day_number));
      if (missingFromList(input, filled).length < short.length) edits = filled;
    } catch (err) {
      console.warn("assistant-anon: asking for the rest of the list failed:", err instanceof Error ? err.message : err);
    }
  }

  // A longer trip goes as far as its new days came back. The rest are named,
  // to be asked for again; with none back, the trip keeps its length.
  let notAdded: number[] = [];
  const firstMissing = added.find((n) => !edits.some((e) => e.day_number === n));
  if (firstMissing !== undefined) {
    notAdded = added.filter((n) => n >= firstMissing);
    edits = edits.filter((e) => e.day_number < firstMissing);
    daysLeft = daysLeft.filter((n) => n < firstMissing);
    tripLength = firstMissing - 1 > current ? firstMissing - 1 : undefined;
    lengthRefused = tripLength === undefined;
  }
  // Rarely, a changed day still doesn't fit an arrival or a departure after
  // the correction: the reply says so rather than leave it for the airport.
  const outsideTimes = outsideTravelTimes(edits, outcome.travelTimes);
  // A list that still came back short says what's missing, whatever the reply claims.
  const listMissing = daysLeft.length === 0 ? missingFromList(input, edits) : [];

  const currency = currencyRequested(input.message) ?? undefined;
  // The count from the dates, when the reply gives another or a cut was turned down.
  const span = tripSpan(input.days, input.startDate);
  const dayCount = span && (keptLength || countsWrong(input, reply, tripLength)) ? span : undefined;
  const finalReply = composeReply({
    reply,
    edits,
    tripLength,
    lockedDays,
    lengthRefused,
    locale: input.locale,
    currentDays: current,
    currency,
    autoApplied: input.autoApply,
    ownLead: input.ownLead,
    costs: planCosts(input.days, input.display),
    costsAfter: planCosts(withEdits(input.days, edits), input.display),
    daysLeft,
    notAdded,
    outsideTimes,
    askedForMoreDays: asksForMoreDays(input.message, input.days.length),
    takenOut: input.explainRemovals && !asksToRemove(input.message) ? takenOut(input.days, edits) : [],
    offersElsewhere: outcome.elsewhere.length > 0,
    listMissing,
    dayCount,
  });

  return {
    reply: finalReply,
    edits,
    tripLength,
    currency,
    ...(outcome.elsewhere.length > 0 ? { elsewhere: outcome.elsewhere } : {}),
    meta: { model: modelId, costUsd, generationTimeMs: Date.now() - startedAt },
  };
}
