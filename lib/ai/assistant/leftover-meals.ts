/**
 * Asked to take the food out of a trip ("remove the restaurants", "no breakfast or lunch"), the model rewrites the
 * days and says it removed them all, and now and then leaves one in: the reply says all, a day still has its café.
 * When the reply says all and the change took out most of the plan's meals at a time of day (breakfast, lunch or
 * dinner) without putting others in, the rest of the plan's meals at that time of day go too, on the days it changes.
 * Never a meal the change put in, a fixed plan, or any when the traveller keeps some ("except the one I booked").
 */

import { isLockedActivity } from "@/lib/ai/anchors-core";
import { isMealStop } from "@/lib/trip/pace";
import type { Activity, ItineraryDay } from "@/types";
import type { DayEdit } from "./edit-validation";
import { SAME_ACTIVITY, sameActivityScore } from "./saved-activities";

type Meal = "breakfast" | "lunch" | "dinner";
const MEALS: Meal[] = ["breakfast", "lunch", "dinner"];

const minutesOf = (time: unknown) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(time ?? ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
/** The meal a stop is, by its time: before 11:00 breakfast, before 16:30 lunch, then dinner. */
function mealOf(a: Activity): Meal | null {
  const at = minutesOf(a.start_time);
  if (!isMealStop(a) || at === null) return null;
  return at < 11 * 60 ? "breakfast" : at < 16 * 60 + 30 ? "lunch" : "dinner";
}

// The reply says the change took them all: "all the restaurants", "tutte le colazioni", "todos los restaurantes".
// "All set" or "All done" alone is no such claim.
const FOOD =
  "restaurants?|restaurantes|ristoranti|caf[eé]s?|caff[eè]|cafeter[ií]as|meals?|pasti|comidas|refei[cç][õo]es|food|cibo|breakfasts?|colazioni|desayunos|lunch(?:es)?|pranzi|almuerzos|almo[cç]os|dinners?|cene|cenas|jantares|eateries|bars";
const SAYS_ALL = new RegExp(
  `(?<![\\p{L}])(?:all|every|tutt[ieoa]|ogni|tod[oa]s)(?:\\s+of)?(?:\\s+(?:the|your|i|le|gli|los|las|os|as|tus|seus|suas))?\\s+(?:${FOOD})(?![\\p{L}])`,
  "iu",
);
// The traveller keeps some of them.
const KEEPS_SOME =
  /(?<![\p{L}])(?:keep|except|apart from|other than|tranne|eccetto|salvo|tieni|tenere|excepto|menos|mant[eé]n|conserva|exceto|mantenha|manter)(?![\p{L}])/iu;
/** Most of a time of day's meals: this share of them taken out (with one left, at least two of three). */
const MOST = 2 / 3;

/**
 * The edits with the plan's meals that the change left in, at a time of day it took most of them from, taken out
 * too, when its reply says it took them all (dropLeftoverMeals' rule above). `asked` is the message and the one a
 * "yes" answers.
 */
export function dropLeftoverMeals<E extends Pick<DayEdit, "day_number" | "activities">>(
  days: ItineraryDay[],
  edits: E[],
  talk: { reply: string; asked: string },
): E[] {
  if (!SAYS_ALL.test(talk.reply) || KEEPS_SOME.test(talk.asked)) return edits;
  const saved = new Map(days.map((d) => [d.day_number, Array.isArray(d.activities) ? d.activities : []]));
  const same = (a: Activity, b: Activity) => (a.id !== undefined && a.id === b.id) || sameActivityScore(a, b) >= SAME_ACTIVITY;
  // Each of the plan's meals on an edited day, and the stop it still is in the change, if any.
  const meals = edits.flatMap((e) =>
    (saved.get(e.day_number) ?? []).flatMap((m) => {
      const meal = mealOf(m);
      return meal && !isLockedActivity(m) ? [{ meal, kept: e.activities.find((a) => same(m, a)) }] : [];
    }),
  );
  // A meal the change put in: one that is none of its day's own.
  const putIn = new Set(
    edits.flatMap((e) => e.activities.filter((a) => !(saved.get(e.day_number) ?? []).some((m) => same(m, a))).flatMap((a) => mealOf(a) ?? [])),
  );
  const goes = new Set(
    MEALS.filter((meal) => {
      const of = meals.filter((m) => m.meal === meal);
      const removed = of.filter((m) => !m.kept).length;
      return !putIn.has(meal) && removed >= MOST * of.length && removed < of.length;
    }),
  );
  if (goes.size === 0) return edits;
  const leftovers = new Set(meals.filter((m) => goes.has(m.meal) && m.kept).map((m) => m.kept!));
  return edits.map((e) => (e.activities.some((a) => leftovers.has(a)) ? { ...e, activities: e.activities.filter((a) => !leftovers.has(a)) } : e));
}
