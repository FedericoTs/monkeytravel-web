import { describe, expect, it } from "vitest";
import { PLAN_SCHEMA } from "./plan-schema";
import { buildStaticChatHistory } from "./trip-prompt";
import { ACTIVITY_TYPES } from "@/lib/trip/activity-type";
import type { ResponseSchema } from "@/lib/ai/genai-compat";

/** The plan call's response schema: the shape every plan comes back in. */

const props = (schema: ResponseSchema | undefined) => schema?.properties ?? {};
const day = props(PLAN_SCHEMA).days?.items;
const activity = props(day).activities?.items;

// The example the plan prompt shows the model (TRIP_OUTPUT_SPEC), as the model reads it.
const example = (() => {
  const text = JSON.stringify(buildStaticChatHistory(""));
  const spec = JSON.parse(text) as Array<{ parts: Array<{ text: string }> }>;
  const all = spec.flatMap((c) => c.parts.map((p) => p.text)).join("\n");
  const from = all.indexOf("this exact structure:");
  const body = all.slice(all.indexOf("{", from), all.indexOf("\n\nRules:", from));
  return JSON.parse(body) as Record<string, unknown>;
})();
const keysOf = (o: unknown) => Object.keys(o as Record<string, unknown>).sort();

describe("the plan's response schema", () => {
  it("holds exactly the fields of the example the prompt shows, at every level", () => {
    const exampleDay = (example.days as unknown[])[0] as Record<string, unknown>;
    const exampleStop = (exampleDay.activities as unknown[])[0] as Record<string, unknown>;
    expect(keysOf(props(PLAN_SCHEMA))).toEqual(keysOf(example));
    expect(keysOf(props(props(PLAN_SCHEMA).destination))).toEqual(keysOf(example.destination));
    expect(keysOf(props(props(PLAN_SCHEMA).trip_summary))).toEqual(keysOf(example.trip_summary));
    expect(keysOf(props(day))).toEqual(keysOf(exampleDay));
    expect(keysOf(props(activity))).toEqual(keysOf(exampleStop));
    expect(keysOf(props(props(activity).coordinates))).toEqual(keysOf(exampleStop.coordinates));
    expect(keysOf(props(props(activity).estimated_cost))).toEqual(keysOf(exampleStop.estimated_cost));
  });

  it("allows every kind of stop the app knows and only those, and the four price tiers", () => {
    expect(props(activity).type?.enum).toEqual([...ACTIVITY_TYPES]);
    expect(props(props(activity).estimated_cost).tier?.enum).toEqual(["free", "budget", "moderate", "expensive"]);
  });

  it("needs every stop's time, length, name, kind, description, place, pin and price, and every day's date and stops", () => {
    expect(activity?.required).toEqual(["start_time", "duration_minutes", "name", "type", "description", "location", "coordinates", "estimated_cost"]);
    expect(day?.required).toEqual(["day_number", "date", "theme", "activities"]);
  });

  it("lets a part of a long trip give the destination only its name and country, and no summary", () => {
    expect(PLAN_SCHEMA.required).toEqual(["destination", "days"]);
    expect(props(PLAN_SCHEMA).destination?.required).toEqual(["name", "country"]);
  });

  it("orders every field, so the days stream in the order the planner reads them", () => {
    const objects = [PLAN_SCHEMA, props(PLAN_SCHEMA).destination, props(PLAN_SCHEMA).trip_summary, day, activity, props(activity).coordinates, props(activity).estimated_cost];
    for (const o of objects) expect([...(o?.propertyOrdering ?? [])].sort()).toEqual(keysOf(props(o)));
    expect(PLAN_SCHEMA.propertyOrdering?.indexOf("days")).toBeGreaterThan(PLAN_SCHEMA.propertyOrdering?.indexOf("destination") ?? 9);
  });
});
