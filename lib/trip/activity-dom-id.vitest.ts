import { describe, expect, it } from "vitest";
import { activityDomId } from "./activity-dom-id";

describe("an activity's element id", () => {
  it("comes from the activity's id", () => {
    expect(activityDomId({ id: "paris-d1-a1", name: "Louvre" })).toBe("activity-paris-d1-a1");
    expect(activityDomId({ id: "x1", name: "" })).toBe("activity-x1");
  });

  it("comes from the name when the activity has no id yet", () => {
    expect(activityDomId({ name: "Café de Flore & Co!" })).toBe("activity-caf-de-flore-co-");
    expect(activityDomId({ id: "", name: "Musée d'Orsay" })).toBe("activity-mus-e-d-orsay");
  });

  it("keeps a name's id to 60 characters after the prefix", () => {
    expect(activityDomId({ name: "a".repeat(80) })).toBe(`activity-${"a".repeat(60)}`);
  });

  it("names a nameless activity unknown", () => {
    expect(activityDomId({ name: "" })).toBe("activity-unknown");
  });
});
