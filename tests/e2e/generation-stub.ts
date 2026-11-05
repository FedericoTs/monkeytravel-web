import type { Page } from "@playwright/test";
import draft from "./fixtures/wizard-draft-paris.json";

/**
 * Answers the wizard's generation as the server would, from the restored-draft
 * fixture, so a test can plan a trip without calling the model. The stream
 * sends what /api/ai/generate/stream sends (metadata, each day, complete); the
 * plan has the requested place and dates, and as many days as they span, its
 * days taken in turn from the fixture.
 */

export interface GenerationRequest {
  destination: string;
  startDate: string;
  endDate: string;
  vibes?: string[];
  locale?: string;
  [key: string]: unknown;
}

type Itinerary = typeof draft.generatedItinerary;

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The plan the stub answers `request` with. */
export function stubPlan(request: GenerationRequest): Itinerary {
  const plan = structuredClone(draft.generatedItinerary);
  const [name, ...rest] = request.destination.split(",").map((s) => s.trim());
  plan.destination = { ...plan.destination, name, country: rest.join(", ") || plan.destination.country };
  const span =
    Math.round((Date.parse(`${request.endDate}T00:00:00Z`) - Date.parse(`${request.startDate}T00:00:00Z`)) / 86_400_000) + 1;
  const source = draft.generatedItinerary.days;
  plan.days = Array.from({ length: span }, (_, i) => {
    const day = structuredClone(source[i % source.length]);
    day.day_number = i + 1;
    day.date = addDays(request.startDate, i);
    for (const activity of day.activities) activity.id = `${activity.id}-d${i + 1}`;
    return day;
  });
  return plan;
}

const sse = (type: string, data: unknown) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;

/** Both generation endpoints answer as they do with the planner out of service. */
export async function stubPlannerOutage(page: Page) {
  const error = "The trip planner is temporarily unavailable";
  await page.route("**/api/ai/generate/stream", (route) =>
    route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: sse("error", { error, code: "upstream" }) })
  );
  await page.route("**/api/ai/generate", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error }) })
  );
}

/**
 * Routes both generation endpoints on `page`. The returned lists fill with the
 * request bodies each endpoint received.
 */
export async function stubGeneration(page: Page) {
  const streamed: GenerationRequest[] = [];
  const json: GenerationRequest[] = [];
  await page.route("**/api/ai/generate/stream", async (route) => {
    const request = route.request().postDataJSON() as GenerationRequest;
    streamed.push(request);
    const plan = stubPlan(request);
    const body =
      sse("metadata", { destination: { name: plan.destination.name, country: plan.destination.country }, totalDays: plan.days.length, language: plan.language, mode: "stream" }) +
      plan.days.map((day) => sse("day", day)).join("") +
      sse("complete", {
        itinerary: plan,
        meta: { generationTimeMs: 1, model: "stub", cached: false, generatedDays: plan.days.length, totalDays: plan.days.length, costUsd: 0 },
      });
    await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body });
  });
  await page.route("**/api/ai/generate", async (route) => {
    const request = route.request().postDataJSON() as GenerationRequest;
    json.push(request);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, itinerary: stubPlan(request) }) });
  });
  return { streamed, json };
}
