import { describe, expect, it } from "vitest";
import { sanitizeItinerary } from "./sanitize";

type Day = { day_number: number; activities: Array<{ name: string; type: string; locked?: boolean }> };

const typesOf = (days: Day[]) => (sanitizeItinerary({ days }) as { days: Day[] }).days.map((d) => d.activities.map((a) => a.type));

describe("sanitizeItinerary", () => {
  it("puts each activity's type on the app's list, reading a vibe from the name", () => {
    expect(
      typesOf([
        {
          day_number: 1,
          activities: [
            { name: "Dinner at Locavore", type: "foodie" },
            { name: "Borough Market", type: "food_market" },
            { name: "Museo Nazionale", type: "museum" },
            { name: "Shibuya Crossing", type: "urban" },
          ],
        },
      ])
    ).toEqual([["restaurant", "market", "museum", "attraction"]]);
  });

  it("leaves a locked activity, the traveller's own commitment, as it is", () => {
    expect(typesOf([{ day_number: 1, activities: [{ name: "Hotel Aurora", type: "lodging", locked: true }] }])).toEqual([["lodging"]]);
  });
});
