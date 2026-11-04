import type { SupportedLanguage } from "@/lib/ai/language";
import { chatLanguageInstruction, replyLanguageRule } from "@/lib/ai/assistant/chat-language";
import type { AssistantMessage } from "@/lib/ai/assistant/thread";
import { ACTIVITY_TYPES } from "@/lib/trip/activity-type";
import type { ItineraryDay, StructuredAssistantResponse } from "@/types";

/** What the trip assistant's chat model is told about the trip. */
export interface TripContext {
  id: string;
  title: string;
  destination: string;
  startDate: string;
  endDate: string;
  budget?: { total: number; currency: string };
  itinerary: ItineraryDay[];
  dayCount: number;
  activityCount: number;
}

/**
 * What the model is allowed to tell the user about a prepared change. Nothing
 * is saved until the user confirms it on the card, so the reply must not say
 * it is done. Every action type goes through here.
 */
export function pendingActionContext(change: string, buttonLabel: string): string {
  return `
IMPORTANT - NOTHING HAS BEEN SAVED. The user's itinerary is UNCHANGED.
What is prepared: ${change}.
A card sits directly below your reply with a button labelled "${buttonLabel}".
The change happens only when the user taps it.
Say in ONE short sentence what you have lined up, then tell them to tap
"${buttonLabel}" below. Use those exact words for the button, so a distracted
reader does not have to work out which control you mean.
NEVER say it is done, made, added, replaced, removed, moved, updated, changed
or saved. Never use the past tense about their itinerary.`;
}

/** One plain-language phrase naming the change, for the frame above. */
export function describeChange(action: NonNullable<StructuredAssistantResponse["action"]>): string {
  const day = action.dayNumber;
  switch (action.type) {
    case "add_day": {
      const nd = action.newDay;
      if (!nd) return `add a new Day ${day}`;
      const theme = nd.theme ? ` themed "${nd.theme}"` : "";
      return `add a new Day ${day} (${nd.date})${theme} with: ${nd.activities.map((a) => a.name).join(", ")}`;
    }
    case "apply_draft": {
      const days = (action.revisedDays ?? []).map((d) => d.day_number).join(", ");
      return days ? `rewrite Day(s) ${days} from the draft they pasted` : `rewrite days from the draft they pasted`;
    }
    default:
      return `change Day ${day}`;
  }
}


// Build system prompt for structured responses
export function buildSystemPrompt(tripContext: TripContext): string {
  return `You are MonkeyTravel's AI assistant - concise, helpful, and action-oriented.

TRIP CONTEXT:
- Destination: ${tripContext.destination}
- Dates: ${tripContext.startDate} to ${tripContext.endDate} (${tripContext.dayCount} days)
- Activities: ${tripContext.activityCount} planned
${tripContext.budget ? `- Budget: ${tripContext.budget.currency} ${tripContext.budget.total}` : ""}

CURRENT ITINERARY:
${tripContext.itinerary.map((day) => `Day ${day.day_number}: ${day.activities.map((a) => `${a.name} (${a.type})`).join(", ")}`).join("\n")}

RESPONSE FORMAT - Return valid JSON only:
{
  "summary": "Brief 1-2 sentence response",
  "cards": [
    // Optional array of cards for rich display
  ]
}

NEVER include an "action" object. Whether the itinerary actually changed is
decided by this system, not by you, and is attached to your reply
automatically. Emitting one produced 12 recorded "removals" that never
happened.

NEVER state or imply in "summary" that anything has been added, replaced,
removed, moved, updated, changed or saved UNLESS a NOTE below explicitly tells
you it was saved. With no such NOTE, you have changed nothing — answer the
question or describe what you would do, in the present or future tense.

CARD TYPES:
1. tip: { "type": "tip", "icon": "lightbulb|warning|info|clock|money|weather", "title": "...", "content": "..." }
2. comparison: { "type": "comparison", "title": "...", "options": [{"name": "", "pros": [], "cons": [], "recommended": true}] }
3. confirmation: { "type": "confirmation", "icon": "check|swap|plus|trash", "title": "...", "description": "..." }

ACTIVITY OBJECT FORMAT:
{
  "id": "act_<unique suffix>",
  "time_slot": "morning|afternoon|evening",
  "start_time": "HH:MM",
  "duration_minutes": 60-180,
  "name": "Activity Name",
  "type": "${ACTIVITY_TYPES.join("|")}",
  "description": "Brief description",
  "location": "Neighborhood/Area",
  "estimated_cost": { "amount": number, "currency": "local currency code", "tier": "budget|moderate|expensive" },
  "tips": ["tip1"],
  "booking_required": false
}

GUIDELINES:
- Be CONCISE - summaries should be 1-2 sentences max
- NEVER put JSON, code blocks, field names or an activity object in "summary".
  It is read by a person on a phone. The change itself is rendered for them
  from real data; describing it in prose is all you are asked for. (This rule
  replaces one telling you to "ALWAYS include the full new activity object" —
  with the action object removed from your reply, that instruction made the
  model paste raw JSON into the chat.)
- Use cards to show structured info instead of long text
- For tips/advice, use tip cards with appropriate icons
- For comparisons, use comparison cards with pros/cons
- Keep the trip's existing style and budget level in mind`;
}

/**
 * What the model is told about this turn's change: that it did not happen and
 * why (checked first), that it waits for the user's confirm on the button
 * labelled `buttonLabel` (with the days a pasted draft did not cover), or a
 * note when nothing was changed. Empty when there is nothing to tell.
 */
export function turnContext(input: {
  failure: string | undefined;
  action: NonNullable<StructuredAssistantResponse["action"]> | undefined;
  buttonLabel: string;
  unmappedDayNumbers: number[];
  note: string | undefined;
}): string {
  const { failure, action, buttonLabel, unmappedDayNumbers, note } = input;
  if (failure) {
    return `
IMPORTANT - THE CHANGE DID NOT HAPPEN. The itinerary is unchanged.
Reason: ${failure}
Tell the user plainly that it did not work and why, in one or two short
sentences, then offer what they can try instead. Never suggest that any part
of it succeeded.`;
  }
  if (action) {
    const change = describeChange(action);
    const extra =
      action.type === "apply_draft" && unmappedDayNumbers.length > 0
        ? ` Days ${unmappedDayNumbers.join(", ")} could not be read from the draft and are unchanged - say so explicitly.`
        : "";
    return pendingActionContext(change, buttonLabel) + extra;
  }
  if (note) {
    return `
NOTE: ${note}`;
  }
  return "";
}

/**
 * The whole prompt of a chat turn: the assistant's instructions and the trip,
 * the reply's language, this turn's context, the thread's last four messages
 * and the user's message.
 */
export function chatPrompt(input: {
  tripContext: TripContext;
  language: SupportedLanguage;
  turn: string;
  thread: AssistantMessage[];
  message: string;
}): string {
  const { tripContext, language, turn, thread, message } = input;
  const history = thread
    .slice(-4)
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n");
  return `${buildSystemPrompt(tripContext)}${chatLanguageInstruction(language) + replyLanguageRule(language)}
${turn}
${history ? `\nRecent conversation:\n${history}\n` : ""}
User: ${message}

Respond with valid JSON only.`;
}
