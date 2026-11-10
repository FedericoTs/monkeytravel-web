/**
 * What the traveller reads about the change the edit engine prepared.
 */

import {
  announcedButMissing,
  announcesProposal,
  claimedTripDays,
  claimsLongerTrip,
  daysLeftNote,
  daysNotAddedNote,
  hasFigures,
  replyLanguage,
  takesOutNote,
  listMissingNote,
  fixedKeptNote,
  cityKeptNote,
  dayCountNote,
  dayCountReply,
  type TripSpan,
  travelTimesNote,
  notAppliedLead,
  claimsItineraryChange,
  lengthUnchangedNote,
  lockedDayReply,
  missingAnswerReply,
  planCostsReply,
  uncoveredDaysNote,
  wizardFallbackReply,
  wizardNothingChangedReply,
  withoutDanglingLead,
  elsewhereNote,
} from "@/lib/ai/assistant/honesty";
import { type PlanCosts } from "@/lib/ai/assistant/plan-costs";
import { daysMentioned } from "@/lib/ai/assistant/day-target";
import { currencySwitchedNote, withoutCurrencyTalk } from "@/lib/ai/assistant/currency-request";
import type { PlacesAway } from "./city-days";
import type { DayEdit } from "./edit-validation";
import { nameTokens, sameWord } from "./saved-activities";
import type { OutsideTravelTimes } from "./travel-times";

const DAY_WORD: Record<string, string> = { en: "Day", es: "Día", it: "Giorno", pt: "Dia" };

/** One line per changed day, from the edits' own summaries. */
function daySummaries(locale: string | undefined, edits: DayEdit[]): string {
  const word = DAY_WORD[locale ?? "en"] ?? DAY_WORD.en;
  return edits
    .filter((e) => e.summary.trim())
    .map((e) => `- ${word} ${e.day_number}: ${e.summary.trim()}`)
    .join("\n");
}

/**
 * What the traveller reads. The model's words are kept only when they match
 * what was actually prepared (pure; unit-tested).
 */
export function composeReply(p: {
  reply: string;
  edits: DayEdit[];
  tripLength?: number;
  /** Fixed plans, by day, that the reply moved or took out: they stay as they were. */
  lockedDays: { dayNumber: number; names: string[] }[];
  lengthRefused: boolean;
  locale?: string;
  currentDays: number;
  currency?: string;
  /** The page applies the edits on arrival, so "I've updated…" will be true. */
  autoApplied?: boolean;
  /** The page says itself that the change waits for its button. */
  ownLead?: boolean;
  /** The plan's activity costs, for an announced total that never came. */
  costs?: PlanCosts | null;
  /** The same, once the change is made. */
  costsAfter?: PlanCosts | null;
  /** Days the change concerns that could not be prepared in time. */
  daysLeft?: number[];
  /** New days of a longer trip that could not be prepared in time. */
  notAdded?: number[];
  /** Changed days that still plan past an arrival or a departure. */
  outsideTimes?: OutsideTravelTimes[];
  /** The traveller asked for a longer trip. */
  askedForMoreDays?: boolean;
  /** Activities the change takes out that the traveller didn't ask to remove. */
  takenOut?: string[];
  /** Places of a list they asked to add that the change doesn't hold. */
  listMissing?: string[];
  /** Places are offered for the whole trip; the page plans the one picked. */
  offersElsewhere?: boolean;
  /** The trip's length from its dates: the reply gave another, or a cut nobody asked for was turned down. */
  dayCount?: TripSpan;
  /** Places of another city taken off a city's days. */
  cityKept?: PlacesAway[];
}): string {
  const prepared = p.edits.length > 0 || p.tripLength !== undefined;
  // Notes join the reply, in its language: a Spanish message about a plan
  // made in English got a Spanish reply with an English note.
  const locale = replyLanguage(p.reply) ?? p.locale;

  // A currency request is answered by the page switching currency; the model
  // cannot change it and used to reply "already in euros" regardless.
  if (p.currency && !prepared) {
    const kept = withoutCurrencyTalk(p.reply);
    const rest = kept && !claimsItineraryChange(kept) ? `${kept} ` : "";
    return `${rest}${currencySwitchedNote(locale, p.currency)}`;
  }

  // Other places for the whole trip are offered, not planned: a reply that
  // says the trip already moved gives way to what the buttons do.
  if (p.offersElsewhere && !prepared) {
    return p.reply && !claimsItineraryChange(p.reply) ? p.reply : elsewhereNote(locale);
  }

  // "You're totally right, 8 days" for 9 days of dates, or a day cut nobody asked
  // for: the count from the dates instead.
  if (p.dayCount && !prepared) return dayCountReply(locale, p.dayCount);

  // A change only to a fixed plan, which stays as it was: the model's "I've
  // moved your flight" would be worse than the bug. Say what happened.
  if (p.lockedDays.length > 0 && !prepared) {
    const d = p.lockedDays[0];
    return lockedDayReply(locale, d.dayNumber, d.names);
  }
  if (!prepared) {
    // Nothing prepared, so nothing may be claimed or handed over
    // (lib/ai/assistant/honesty).
    if (p.lengthRefused || claimsItineraryChange(p.reply) || announcesProposal(p.reply)) {
      return wizardNothingChangedReply(locale);
    }
    // "Here is the total…" with no total: give the plan's own figures instead,
    // unless figures came before an announcement that ends the reply.
    const missing = announcedButMissing(p.reply);
    if (missing) {
      const before = withoutDanglingLead(p.reply);
      if (before !== p.reply.trim() && hasFigures(before)) return before;
      return missing === "cost" && p.costs ? planCostsReply(locale, p.costs) : missingAnswerReply(locale);
    }
    return p.reply || wizardFallbackReply(locale, false);
  }

  let text = p.reply || p.edits.map((e) => e.summary).filter(Boolean).join(" ") || wizardFallbackReply(locale, true);
  // Next to a currency switch, the model's "the plan is already in EUR" goes;
  // the prices of the change stay.
  if (p.currency) text = withoutCurrencyTalk(text, true) || text;
  // "Here's how the revised costs look:" and nothing after it: the figures,
  // from the plan as changed, or what each day now does.
  const missing = announcedButMissing(text);
  if (missing) {
    const answer = missing === "cost" && p.costsAfter ? planCostsReply(locale, p.costsAfter) : daySummaries(locale, p.edits);
    text = [withoutDanglingLead(text), answer].filter(Boolean).join("\n") || wizardFallbackReply(locale, true);
  }
  // The reply names days the edit doesn't include (a "swap" with one side
  // missing): say so rather than let the Apply card look like the whole of it.
  const covered = p.edits.map((e) => e.day_number);
  const removed =
    p.tripLength !== undefined && p.tripLength < p.currentDays
      ? Array.from({ length: p.currentDays - p.tripLength }, (_, i) => p.tripLength! + 1 + i)
      : [];
  const left = p.daysLeft ?? [];
  const notAdded = p.lengthRefused ? [] : (p.notAdded ?? []);
  const uncovered = daysMentioned(text).filter(
    (n) => !covered.includes(n) && !removed.includes(n) && !left.includes(n) && !notAdded.includes(n),
  );
  if (uncovered.length > 0 && covered.length > 0) text = `${text} ${uncoveredDaysNote(locale, covered, uncovered)}`;
  if (left.length > 0) text = `${text} ${daysLeftNote(locale, left)}`;
  if (notAdded.length > 0) text = `${text} ${daysNotAddedNote(locale, notAdded)}`;
  for (const v of p.outsideTimes ?? []) text = `${text} ${travelTimesNote(locale, v)}`;
  // A reply that gives the trip more days than the change leaves it ("I've
  // updated your trip to have 16 days" on 14 days) says so too.
  const saysLonger =
    p.tripLength === undefined && ((p.askedForMoreDays && claimsLongerTrip(text)) || (claimedTripDays(text) ?? 0) > p.currentDays);
  if (p.lengthRefused || saysLonger) {
    text = `${text} ${lengthUnchangedNote(locale, p.currentDays)}`;
  }
  // "Add a Jameson tour" quietly replaced the Guinness visit: name what goes,
  // unless the reply did ("the Gràcia activities" for "Lunch at Con Gracia").
  const said = nameTokens(text);
  const namedInReply = (name: string) => {
    const words = nameTokens(name);
    const found = words.filter((w) => said.some((s) => sameWord(w, s))).length;
    return text.toLowerCase().includes(name.toLowerCase()) || (words.length > 0 && found >= words.length / 2);
  };
  const unmentioned = (p.takenOut ?? []).filter((n) => !namedInReply(n));
  if (unmentioned.length > 0) text = `${text} ${takesOutNote(locale, unmentioned)}`;
  // "I've added all ten" with eight in the change: name the two.
  if ((p.listMissing?.length ?? 0) > 0) text = `${text} ${listMissingNote(locale, p.listMissing!)}`;
  // A fixed plan the reply moved or took out is back as the traveller set it.
  for (const d of p.lockedDays) text = `${text} ${fixedKeptNote(locale, d.dayNumber, d.names)}`;
  if (p.dayCount) text = `${text} ${dayCountNote(locale, p.dayCount)}`;
  // Places of another city that came off a city's days.
  const offCity = new Map<string, { other: string; city: string; names: string[] }>();
  for (const x of p.cityKept ?? []) {
    const key = `${x.other}\n${x.city}`;
    const entry = offCity.get(key) ?? { other: x.other, city: x.city, names: [] };
    entry.names.push(...x.activities.map((a) => a.name));
    offCity.set(key, entry);
  }
  for (const x of offCity.values()) text = `${text} ${cityKeptNote(locale, x.other, x.city, x.names)}`;
  // Told to present an unapplied edit as ready, the model still writes "I've
  // updated…" most of the time: lead with the truth so Apply isn't skipped.
  if (!p.autoApplied && !p.ownLead && claimsItineraryChange(p.reply)) text = `${notAppliedLead(locale)} ${text}`;
  if (p.currency) text = `${text} ${currencySwitchedNote(locale, p.currency)}`;
  return text;
}
