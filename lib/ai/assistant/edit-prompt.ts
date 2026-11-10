/**
 * What the edit engine (lib/ai/assistant/engine.ts) asks the model: the plan as
 * it stands, the conversation so far and the rules a reply follows.
 */

import { DEFAULT_LANGUAGE, isSupportedLanguage, LANGUAGE_NAMES } from "@/lib/ai/language";
import { lockedActivityNames } from "@/lib/ai/anchors-core";
import {
  planCosts,
  planCurrency,
  type DisplayCurrency,
  type PlanCosts,
} from "@/lib/ai/assistant/plan-costs";
import { addDaysISO, MAX_TRIP_DAYS_MULTI, maxTripDays } from "@/lib/ai/assistant/structural";
import type { TripSpan } from "@/lib/ai/assistant/honesty";
import type { ItineraryDay } from "@/types";
import { ACTIVITY_TYPES } from "@/lib/trip/activity-type";

// How a reply presents an edit that is still waiting to be saved, per language:
// the model kept writing "I've added" / "Ho aggiunto" for an unsaved edit, and
// "I've extended your trip" slipped past a list of verbs.
const READY_WORDING: Record<string, string> = {
  en: `present the edits as ready to save, not done: "Here's a new Day 6 with…", "Ready to swap Days 1 and 2:…", "Here are 7 new days, ready to save:…". Never say you have done it: no "I've added", "I've extended", "I've swapped", "I've moved", "Done".`,
  it: `presenta le modifiche come pronte da salvare, non fatte: "Ecco un nuovo giorno 6 con…", "Pronto a scambiare i giorni 1 e 2:…", "Ecco 7 nuovi giorni, pronti da salvare:…". Non dire mai di averlo fatto: niente "Ho aggiunto", "Ho esteso", "Ho spostato", "Ho scambiato", "Fatto".`,
  es: `presenta los cambios como listos para guardar, no hechos: "Aquí tienes un nuevo día 6 con…", "Listo para cambiar los días 1 y 2:…", "Aquí tienes 7 días nuevos, listos para guardar:…". Nunca digas que ya lo hiciste: nada de "He añadido", "He ampliado", "He movido", "He cambiado", "Hecho".`,
  pt: `apresente as mudanças como prontas para salvar, não feitas: "Aqui está um novo dia 6 com…", "Pronto para trocar os dias 1 e 2:…", "Aqui estão 7 dias novos, prontos para salvar:…". Nunca diga que já fez: nada de "Adicionei", "Estendi", "Movi", "Troquei", "Feito".`,
};

// How a reply presents an edit the page makes as it arrives (with Undo): told
// to word every edit as ready, the planner said "Ready to update Day 2…" of
// changes it had already made.
const DONE_WORDING: Record<string, string> = {
  en: `the page makes the change as soon as you reply, and they can undo it, so say what you did: "I've added a cooking class to Day 3", "Days 1 and 2 are swapped". Never write "Ready to…" or ask them to apply it.`,
  it: `la pagina fa la modifica appena rispondi, e si può annullare, quindi di' cosa hai fatto: "Ho aggiunto un corso di cucina al giorno 3", "Ho scambiato i giorni 1 e 2". Non scrivere mai "Pronto a…" e non chiedere di applicarla.`,
  es: `la página hace el cambio en cuanto respondes, y se puede deshacer, así que di lo que hiciste: "He añadido una clase de cocina al día 3", "He cambiado los días 1 y 2". Nunca escribas "Listo para…" ni pidas que lo apliquen.`,
  pt: `a página faz a mudança assim que você responde, e dá para desfazer, então diga o que fez: "Adicionei uma aula de culinária no dia 3", "Troquei os dias 1 e 2". Nunca escreva "Pronto para…" nem peça para aplicar.`,
};

/** Days one reply may rewrite; more would not fit the output budget. */
export const MAX_DAYS_PER_REPLY = 6;

export interface AssistTurn {
  role: "user" | "assistant";
  text: string;
}

export interface AssistInput {
  message: string;
  destination: string;
  tripTitle: string;
  days: ItineraryDay[];
  startDate?: string;
  endDate?: string;
  locale?: string;
  /**
   * The conversation so far, oldest first, so "sure", "yes" or "No I mean…"
   * have something to refer to. Before the last six turns it may hold only
   * the traveller's own messages.
   */
  history?: AssistTurn[];
  /** The page applies the edits as soon as they arrive (with Undo). */
  autoApply?: boolean;
  /**
   * The page itself says that a change waits for its button (the trip page),
   * so the reply gets no "Not applied yet" lead here.
   */
  ownLead?: boolean;
  /**
   * False when the traveller may not change the number of days: on the trip
   * page that moves the dates, which stay with the owner.
   */
  canAddDays?: boolean;
  /**
   * The reply names activities a change takes out that weren't asked to go.
   * The wizard's card shows only the new day; the trip page's card lists them.
   */
  explainRemovals?: boolean;
  /** The currency the page shows prices in, when it isn't the plan's own. */
  display?: DisplayCurrency;
  /**
   * A change the last reply prepared that the traveller hasn't saved yet,
   * which `days` already include: one line per day it changes.
   */
  unsaved?: string[];
  /**
   * The page can plan the whole trip somewhere else (the wizard): asked for
   * another place, the reply offers places instead of rewriting the days, and
   * the page plans the one picked anew, for the same dates.
   */
  canPlanElsewhere?: boolean;
}

/**
 * Whether a reply may offer another place for the whole trip: on a page that
 * can plan it (canPlanElsewhere), for a trip in one place with no fixed plans,
 * which a plan for another place could not keep.
 */
export function canOfferElsewhere(input: AssistInput): boolean {
  return (
    input.canPlanElsewhere === true &&
    !input.days.some((d) => d.city) &&
    input.days.every((d) => lockedActivityNames(d).length === 0)
  );
}

/**
 * The plan's activity costs, as the traveller sees them, so a question about
 * the total gets real figures rather than the model's own arithmetic.
 */
function costLines(costs: PlanCosts | null): string {
  if (!costs) return "";
  const view = costs.shown ?? costs;
  const perDay = view.perDay.map((d) => `Day ${d.day} ~${d.amount}`).join(", ");
  const own = costs.shown ? ` (${costs.total} ${costs.currency} in the plan's own amounts)` : "";
  // Travel between a multi-city plan's cities is a priced card of the plan.
  return `Activity costs, as the traveller sees them in ${view.currency}: ${perDay}. Total ~${view.total} ${view.currency}${own}. These count only what the plan lists: hotels, and any travel it doesn't list, cost extra.\n`;
}

/** A day's date: its own, or counted from the trip's start. */
function dateOf(day: ItineraryDay | undefined, startDate?: string): string | null {
  if (!day) return null;
  return addDaysISO(day.date, 0) ?? addDaysISO(startDate, day.day_number - 1);
}

/** The trip's first and last dates and its number of days, when its dates are known. */
export function tripSpan(days: ItineraryDay[], startDate?: string): TripSpan | null {
  const from = dateOf(days[0], startDate);
  const to = dateOf(days[days.length - 1], startDate);
  return from && to ? { from, to, days: days.length } : null;
}

const PROMPT_DATE = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const promptDate = (iso: string) => PROMPT_DATE.format(new Date(`${iso}T00:00:00Z`));
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** How long the trip is, counted from its dates: what a reply must hold to. */
export function tripLengthLine(days: ItineraryDay[], startDate?: string): string {
  const n = days.length;
  const span = tripSpan(days, startDate);
  const length = `${count(n, "day", "days")} and ${count(n - 1, "night", "nights")}, Day 1 to Day ${n}`;
  return span ? `The trip is ${promptDate(span.from)} to ${promptDate(span.to)}: ${length}.` : `The trip is ${length}.`;
}

// Each price names its currency, and the one the traveller sees when that
// differs: a bare "(~250)" next to a euro total was quoted back as euros.
// Each day shows its date, so "count them, day by day" has the dates to count.
function buildContext(days: ItineraryDay[], display?: DisplayCurrency, startDate?: string): string {
  const cur = planCurrency(days);
  const shown = display && display.currency !== cur && display.rate > 0 ? display : undefined;
  return days
    .slice(0, MAX_TRIP_DAYS_MULTI)
    .map((d) => {
      const acts = Array.isArray(d.activities)
        ? d.activities
            .map((a) => {
              const cost = a?.estimated_cost?.amount;
              const seen = typeof cost === "number" && shown ? ` ≈ ${Math.round(cost * shown.rate)} ${shown.currency}` : "";
              const costStr = typeof cost === "number" && cost > 0 ? ` (~${cost} ${cur}${seen})` : "";
              return a && typeof a.name === "string" ? `${a.name}${costStr}` : "";
            })
            .filter(Boolean)
            .join(", ")
        : "";
      const label = d.theme || d.title || "";
      const city = d.city ? ` [${d.city}]` : "";
      const date = dateOf(d, startDate);
      return `Day ${d.day_number}${date ? ` (${promptDate(date)})` : ""}${city}${label ? ` — ${label}` : ""}: ${acts}`;
    })
    .join("\n");
}

/** Turns the prompt shows in full; before them, only what the traveller said. */
const RECENT_TURNS = 6;
const EARLIER_MESSAGES = 10;

function buildHistory(history: AssistTurn[] | undefined): string {
  const all = history ?? [];
  const turns = all.slice(-RECENT_TURNS);
  if (turns.length === 0) return "";
  // What they told us about the trip holds after it leaves the last turns: a
  // 23:00 arrival said four messages earlier still rules out dinner on Day 1.
  const earlier = all
    .slice(0, -RECENT_TURNS)
    .filter((t) => t.role === "user")
    .slice(-EARLIER_MESSAGES)
    .map((t) => `- ${t.text.slice(0, 400)}`);
  const said = earlier.length > 0 ? `\nEarlier, the traveller said (oldest first):\n${earlier.join("\n")}\n` : "";
  const lines = turns.map((t) => `${t.role === "user" ? "Traveller" : "You"}: ${t.text.slice(0, 600)}`);
  // Undo and Skip leave the conversation as it was: "already done" was the
  // answer to a request repeated after an Undo.
  return `${said}\nConversation so far (oldest first):\n${lines.join("\n")}\nThe itinerary above is the plan as it is now. A change from earlier in the conversation that isn't in it was only offered, skipped or undone: if they ask for it, make it.\n`;
}

export function buildPrompt(input: AssistInput): string {
  const language = LANGUAGE_NAMES[isSupportedLanguage(input.locale) ? input.locale : DEFAULT_LANGUAGE];
  const cur = planCurrency(input.days);
  const costs = planCosts(input.days, input.display);
  const shownCur = costs?.shown?.currency ?? input.display?.currency ?? cur;
  const maxDays = maxTripDays(input.days);
  const lengthLine = tripLengthLine(input.days, input.startDate);
  const multiCity = input.days.some((d) => d.city);
  const elsewhere = canOfferElsewhere(input);
  const unsaved = input.unsaved?.length
    ? `Not saved yet: your last reply prepared this change, the traveller hasn't saved it, and the itinerary above already includes it. Saving your reply saves it too.\n${input.unsaved.map((l) => `- ${l}`).join("\n")}\nIf they turn it down, undo it in your edits: take out what it added and put back what it took out.\n`
    : "";
  return `You are MonkeyTravel's sharp, friendly travel assistant, helping a traveller with the trip they just generated. You can answer questions AND revise the plan.

Trip: ${input.tripTitle}
Destination: ${input.destination}
${lengthLine}
Currency: ${cur}
Itinerary:
${buildContext(input.days, input.display, input.startDate)}
${costLines(costs)}${unsaved}${buildHistory(input.history)}
Traveller's new message: "${input.message}"

First work out what the traveller actually wants, the way a good travel agent would:
- A statement about their trip asks you to fit the plan to it: "we have a car", "my hotel is near X", "we land at 11:00 on day 1", "my wife is vegetarian", "I'm travelling with my 70-year-old mother". Change every day it affects.
- A limit on distance or time ("close to the wineries", "walkable", "no more than 20 minutes from the hotel") holds for the whole plan, not just the stop it mentions. Check every stop it touches on your first answer, and move the stay or the stops until they fit. Say in "reply" which stop still can't.
- What they told you about their trip, in this message or earlier in the conversation, still holds unless they changed it: when they arrive and leave, who is travelling, a car, a diet, where they stay. Every day you edit or add must fit it. Their earlier requests were already answered: don't make them again unless asked.
- The trip's length above is counted from its dates and is always right. Never agree to another count, however sure they are: people often count the nights, or leave out the day they arrive. Say kindly how it's counted, day by day with the dates if they ask. Insisting on a count isn't asking to change it: add or remove days only when they ask for that.
- A misspelled or partial name means the most likely real place near the destination ("aya sofya" is Hagia Sophia).
- Ambiguous wording takes the meaning a travel agent would assume ("activities under 18" means suitable for under-18s). Ask one short question only when the readings would lead to very different plans.
- A short "yes", "ok", "do it" or "continue" answers your previous message: make exactly the change you offered there, or the one it said some days still needed, nothing more. With nothing offered before it, ask what they'd like to change.
- A message can ask for several things: do every one. Before answering, check each part against your edits; if a part can't be done, say which and why in "reply".
- The traveller can undo or skip any change, so when a request is clear enough, make it instead of asking for permission or for details, and mention any trade-off in "reply".

Then decide:
- A QUESTION or general advice: answer it, and return "edits": [].
  - Asked for a summary or overview: give one short line per day.
  - Asked where to stay or for hotels: suggest 2-3 concrete areas or well-known hotels near where this plan spends its days, each with a short reason, as ideas to check.
  - Asked for a PDF, a file or a printout: you can't make files; point them to the page's own options (save the trip, share its link, or print the page from the browser).
${
    elsewhere
      ? `- The WHOLE trip somewhere else ("give me Málaga", "I don't want to visit Mysore", "do Porto instead", "suggest other destinations"): never rewrite the days for another place. Put the place they name in "elsewhere", or 2-3 good places when they name none, and return "edits": []. In "reply", one short line per place says why it fits, as an offer: the page plans the one they pick, for the same dates. A day trip or a stop on the way from ${input.destination} is not this: edit the days for it.
`
      : ""
  }- A request to CHANGE the plan: return every day that changes, each rewritten in full, in "edits". Change only what was asked: keep every other activity exactly as it is, under its exact name (never translate or rename activities), and leave days that don't need to change alone.
  - A change about the whole trip ("every day", "all the dinners", "cheaper", "less packed", a car, a diet) applies to every day it concerns, not just one.
  - A day the traveller names is the day to change. If that clashes with the day's plan, still make the change there and note the trade-off in "reply".
  - Something already in the plan: say on which day. If they want it on another day or at another time, move it there instead of adding it twice.
  - Moving or swapping activities between days changes BOTH days: return both.
  - Something to add with no day named ("add a cooking class", "suggest a restaurant to add"): pick the day with the most room where it fits, add it there without removing anything, and name that day in "reply". Don't ask which day.
  - Adding never removes an activity unless the day can't fit both. When a change leaves an activity already in the plan without room (what they add, a late arrival, a closure, a long drive), move that activity to another day with room rather than dropping it, and say where it went.
  - A list of places to add (restaurants, bars, shops, sights): add every one, each once, on the day and at the time it fits best: near that day's other stops, and a restaurant at lunch or dinner, when it's open as far as you know. Spread them over as many days as they need. If one can't fit anywhere, say which in "reply" and why.
  - A message that only says what's coming ("I'll send you the restaurants") or sets a rule for the requests that follow ("don't remove anything") changes nothing yet: say you're ready, repeat the rule in a few words, and return "edits": [].
  - Asked for alternatives or other things to do: put your best picks into the plan as edits, so they can be applied, say in "reply" what they replace, and name one or two other good options they can ask for instead. If they want to choose first ("I'll let you know"), list the options in "reply" and change nothing yet.
  - Keep the number of days unless the traveller asks for more or fewer. A new place or day trip goes into the existing days, replacing the lightest day or part of one, and "reply" says what it replaces.
  - ${
    input.canAddDays === false
      ? `Only the trip's owner can change how many days it has, and this traveller isn't the owner: keep "trip_length" null and add no days. Asked for more days, say that only the owner can add them, and give your ideas for those days in "reply" instead, one short line each.`
      : `Adding or removing days when asked, or changing how many nights a city gets: set "trip_length" to the new total number of days (1-${maxDays}) and return every day whose content changes, including each NEW day in full. New days come first, before any existing day you also change. New days in the middle of the trip move the later days along, so those days change too, up to the new last day. Days beyond "trip_length" are removed.`
  }${multiCity ? `
  - This is a multi-city trip: give each edited day its "city".` : ""}
  - Hotels in the plan: use only hotel names the traveller gives you or that already appear in the itinerary. If they mention hotels you can't see ("the hotels I added"), ask for the names and return "edits": []. When they name where they're staying for certain nights, add a short "Check in at <place>" activity in the evening of the first of those days. The plan doesn't track hotel prices; give a typical range if they ask.
  - At most ${MAX_DAYS_PER_REPLY} days in "edits". When the change concerns more days, new days included, return the first ${MAX_DAYS_PER_REPLY} and list every other day it concerns in "more_days": those are made right after, the same way, so "reply" describes the whole change for every day it concerns, never only "the first ${MAX_DAYS_PER_REPLY} days".
- Use only real places, where they really are. If something they ask for doesn't exist nearby, say so and offer the closest real alternative. Give prices and travel times you're unsure of as rough ranges.
- If you can't do what they ask, say so plainly and return "edits": [].

Return STRICT JSON (no markdown) in this EXACT shape:
{
  "reply": "Short chat reply in the language of the traveller's new message (${language} if unclear).",
  "trip_length": null OR <new total number of days, only when adding or removing days>,${
    elsewhere
      ? `
  "elsewhere": [] OR [{ "name": "city or area", "country": "its country" }] (only for the whole trip somewhere else),`
      : ""
  }
  "more_days": [] OR [the other day numbers this change concerns, past the ${MAX_DAYS_PER_REPLY} in "edits"],
  "travel_times": [] OR [{ "day": <day number>, "arrives": "HH:MM" or null, "leaves": "HH:MM" or null, "by": "flight" | "train" | "bus" | "boat" | "car" }],
  "edits": [
    {
      "day_number": <1-${maxDays}>,${multiCity ? `
      "city": "the city this day is in",` : ""}
      "summary": "One concise sentence, in ${language}, describing the change to this day.",
      "theme": "short day theme in ${language}",
      "activities": [
        {
          "time_slot": "morning" | "afternoon" | "evening",
          "start_time": "HH:MM",
          "duration_minutes": <integer>,
          "name": "Place or activity name (real, in the destination)",
          "type": ${ACTIVITY_TYPES.map((t) => `"${t}"`).join(" | ")},
          "description": "1 short sentence in ${language}",
          "location": "neighbourhood or area",
          "coordinates": { "lat": <latitude, 6 decimals>, "lng": <longitude, 6 decimals> } (where the place really is),
          "estimated_cost": { "amount": <number in ${cur}>, "currency": "${cur}", "tier": "free" | "budget" | "moderate" | "expensive" },
          "booking_required": false
        }
      ]
    }
  ]
}

Rules:
1. JSON only. "edits" is [] for questions.
2. A day you plan from scratch has 3-5 activities. A day you add to keeps every activity it had, so it may end up with more than 5: that's fine while its times still work (meals at meal times, time to get between stops). Fewer when the traveller asks to remove things. Real places, costs realistic in ${cur}. Never fill a gap with a placeholder like "free time for lunch". A day they want free has no activities: "activities": []. Keep "description" to a few words.
3. For a change, "reply" is warm and brief and says what changed, one short line per day when several days change, describing exactly the edits you return. Never say you changed a day that is not in "edits". ${
    input.autoApply
      ? `For the wording, ${DONE_WORDING[input.locale ?? "en"] ?? DONE_WORDING.en}`
      : `Nothing changes until the traveller saves it, so ${READY_WORDING[input.locale ?? "en"] ?? READY_WORDING.en}`
  } Never mention JSON.
4. For a question, the whole answer goes in "reply". When it needs figures (a total, a budget, what a day costs), give the numbers right there, in ${shownCur}: start from the activity costs above and add clearly labelled estimates for what the plan leaves out, such as hotels and flights. A few short lines are fine, as plain text: each on its own line starting with "- ", no * or **. Never announce an answer ("here is the total…") without giving it. A practical answer ends with what to do about it (what to pack, what to book ahead).
5. Only real, safe, legal travel. If the request is impossible or off-topic, return "edits": [] and explain kindly in "reply".
6. USER OVERRIDE: if the user asks for a place outside ${input.destination} (e.g. a day-trip across a border), you may note the travel-time tradeoff ONCE in "reply" — but if they insist, comply and build the edit exactly as they asked. Never refuse the same request twice.${
    elsewhere ? ` This is for a day trip or a stop: the whole trip in another place always goes in "elsewhere".` : ""
  }
7. The app shows prices in the traveller's chosen currency by itself. A request to see prices in another currency needs no edits: never rewrite days to change the currency, and don't say which currency the plan is shown in. Prices are per person: asked for a group's costs ("for 2 people"), give that many people's totals in "reply" and change nothing.
8. Times are "HH:MM" and the plan shows them in 24-hour form. A request for AM/PM times needs no edits: say the plan shows 24-hour times.
9. "travel_times" lists every time the traveller has said they arrive or leave, in this message or earlier (the latest wins), on the day it happens, whether or not you change that day; "by" is "flight" when they fly or land, or when it's unclear. On those days plan nothing before about 1.5 hours after landing (45 minutes after a train, bus or boat), and end everything by when they must set off: about 3 hours before a flight, 1 hour before a train, bus or boat. Only the arrival, the transfer, the check-in and the way to the airport or station may sit outside those hours.`;
}
