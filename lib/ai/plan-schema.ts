/**
 * The shape a plan comes back in, given to the model as its response schema. The plan call used to ask for JSON after
 * an example (TRIP_OUTPUT_SPEC in lib/ai/trip-prompt.ts) and the model could write anything: a slip, a missing comma
 * or a stray quote, was mended (lib/ai/json-mend.ts), or the plan was written again, or the traveller got an error.
 * With the shape as the schema, what the model writes is always valid JSON of it: every stop with its time, length,
 * name, kind (one of the app's), place and price tier. It holds the example's fields only; whatever else a plan or a
 * stop carries is added by the server.
 */
import { SchemaType, type ResponseSchema } from "@/lib/ai/genai-compat";
import { ACTIVITY_TYPES } from "@/lib/trip/activity-type";

const text: ResponseSchema = { type: SchemaType.STRING };
const texts: ResponseSchema = { type: SchemaType.ARRAY, items: text };

const ACTIVITY: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    start_time: { type: SchemaType.STRING, description: "HH:MM, 24-hour clock" },
    duration_minutes: { type: SchemaType.INTEGER },
    name: text,
    type: { type: SchemaType.STRING, enum: [...ACTIVITY_TYPES] },
    description: text,
    location: text,
    address: text,
    coordinates: {
      type: SchemaType.OBJECT,
      properties: { lat: { type: SchemaType.NUMBER }, lng: { type: SchemaType.NUMBER } },
      required: ["lat", "lng"],
      propertyOrdering: ["lat", "lng"],
    },
    official_website: { type: SchemaType.STRING, nullable: true },
    estimated_cost: {
      type: SchemaType.OBJECT,
      properties: {
        amount: { type: SchemaType.NUMBER },
        currency: text,
        tier: { type: SchemaType.STRING, enum: ["free", "budget", "moderate", "expensive"] },
      },
      required: ["amount", "currency", "tier"],
      propertyOrdering: ["amount", "currency", "tier"],
    },
    tips: texts,
    booking_required: { type: SchemaType.BOOLEAN },
  },
  required: ["start_time", "duration_minutes", "name", "type", "description", "location", "coordinates", "estimated_cost"],
  propertyOrdering: [
    "start_time",
    "duration_minutes",
    "name",
    "type",
    "description",
    "location",
    "address",
    "coordinates",
    "official_website",
    "estimated_cost",
    "tips",
    "booking_required",
  ],
};

const DAY: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    day_number: { type: SchemaType.INTEGER },
    date: { type: SchemaType.STRING, description: "YYYY-MM-DD" },
    theme: text,
    activities: { type: SchemaType.ARRAY, items: ACTIVITY },
  },
  required: ["day_number", "date", "theme", "activities"],
  propertyOrdering: ["day_number", "date", "theme", "activities"],
};

/** A whole plan, or a part of a long one (which gives the destination only its name and country, and no summary). */
export const PLAN_SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    destination: {
      type: SchemaType.OBJECT,
      properties: { name: text, country: text, description: text, best_for: texts, weather_note: text },
      required: ["name", "country"],
      propertyOrdering: ["name", "country", "description", "best_for", "weather_note"],
    },
    days: { type: SchemaType.ARRAY, items: DAY },
    trip_summary: {
      type: SchemaType.OBJECT,
      properties: {
        total_estimated_cost: { type: SchemaType.NUMBER },
        currency: text,
        highlights: texts,
        packing_suggestions: texts,
      },
      propertyOrdering: ["total_estimated_cost", "currency", "highlights", "packing_suggestions"],
    },
  },
  required: ["destination", "days"],
  propertyOrdering: ["destination", "days", "trip_summary"],
};
