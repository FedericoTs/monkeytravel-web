import { describe, expect, it } from "vitest";
import { notBefore, plannedMinutes, shortenedToFit, withStopAt, type TimedStop } from "./day-room";

const stop = (name: string, type: string, start_time: string, duration_minutes: number): TimedStop => ({
  name,
  type,
  start_time,
  duration_minutes,
});
const timed = (day: { activities?: TimedStop[] } | null) => (day?.activities ?? []).map((a) => `${a.start_time} ${a.name}`);

// A morning sight of three hours put into a full day.
const MORNING_SIGHT = stop("Taj Mahal", "landmark", "08:00", 180);

describe("withStopAt", () => {
  it("puts the stop in at its own time and moves the stops after it later, a short walk apart", () => {
    const day = { activities: [stop("Fort", "landmark", "09:00", 120), stop("Garden", "park", "16:00", 60)] };
    expect(timed(withStopAt(day, MORNING_SIGHT))).toEqual(["08:00 Taj Mahal", "11:20 Fort", "16:00 Garden"]);
    expect(withStopAt(day, MORNING_SIGHT)?.activities?.[1].time_slot).toBe("morning");
  });

  it("puts the stop in right after a given stop when asked, ahead of one that starts at its time", () => {
    const day = { activities: [stop("Reef park", "park", "09:30", 150), stop("Punta Sur", "nature", "12:30", 90), stop("Beach", "beach", "14:30", 120)] };
    const lunch = stop("Lunch", "restaurant", "12:30", 60);
    // By its time it goes after Punta Sur, which starts at 12:30 too.
    expect(timed(withStopAt(day, lunch))).toEqual(["09:30 Reef park", "12:30 Punta Sur", "14:20 Lunch", "15:40 Beach"]);
    expect(timed(withStopAt(day, lunch, {}, 1))).toEqual(["09:30 Reef park", "12:30 Lunch", "13:50 Punta Sur", "15:40 Beach"]);
  });

  it("brings a meal the move would push well past its hour ahead of the sight pushing it", () => {
    const day = {
      activities: [
        stop("Tomb", "landmark", "09:00", 120),
        stop("Lunch place", "restaurant", "11:30", 90),
        stop("Bazaar", "market", "13:30", 120),
        stop("Second tomb", "landmark", "16:00", 120),
        stop("Dinner place", "restaurant", "19:00", 90),
      ],
    };
    // Kept in order, lunch would start at 13:40, over two hours late.
    expect(timed(withStopAt(day, MORNING_SIGHT))).toEqual([
      "08:00 Taj Mahal",
      "11:30 Lunch place",
      "13:20 Tomb",
      "15:40 Bazaar",
      "18:00 Second tomb",
      "20:20 Dinner place",
    ]);
  });

  it("takes a late lunch ahead of the stop put in, when that stop starts at or after lunch as it is", () => {
    const day = {
      activities: [stop("Gallery", "museum", "10:00", 150), stop("Lunch place", "restaurant", "12:30", 60), stop("Play", "entertainment", "19:30", 150)],
    };
    // Put in at ten, the tower starts after the gallery, at ten to one: lunch first, not at ten past four.
    expect(timed(withStopAt(day, stop("Tower", "landmark", "10:00", 180)))).toEqual(["10:00 Gallery", "12:50 Lunch place", "14:10 Tower", "19:30 Play"]);
    expect(timed(withStopAt(day, stop("Tower", "landmark", "10:00", 180), { keepShape: true }))).toEqual([
      "10:00 Gallery",
      "12:50 Lunch place",
      "14:10 Tower",
      "19:30 Play",
    ]);
  });

  it("still never takes a later meal past the stop put in, once an earlier one went ahead of it", () => {
    const day = {
      activities: [stop("Gallery", "museum", "10:00", 150), stop("Lunch place", "restaurant", "12:30", 60), stop("Dinner place", "restaurant", "17:00", 60)],
    };
    // Lunch goes ahead of the tower; dinner, at five, stays behind it, late as it is.
    expect(timed(withStopAt(day, stop("Tower", "landmark", "10:00", 300)))).toEqual([
      "10:00 Gallery",
      "12:50 Lunch place",
      "14:10 Tower",
      "19:30 Dinner place",
    ]);
  });

  describe("asked to keep the day's shape", () => {
    const DAYTIME = { keepShape: true };

    it("has no room when a sight would be pushed past the late afternoon, when it would be shut", () => {
      const day = {
        activities: [
          stop("Tomb", "landmark", "09:00", 120),
          stop("Lunch place", "restaurant", "11:30", 90),
          stop("Bazaar", "market", "13:30", 120),
          stop("Second tomb", "landmark", "16:00", 120),
          stop("Dinner place", "restaurant", "19:00", 90),
        ],
      };
      // The second tomb would start at six.
      expect(withStopAt(day, MORNING_SIGHT, DAYTIME)).toBeNull();
      // The stop put in is held to it too: after a long morning the museum would start at five.
      const longMorning = { activities: [stop("Fort", "landmark", "08:00", 520)] };
      expect(withStopAt(longMorning, stop("Museum", "museum", "10:00", 60), DAYTIME)).toBeNull();
      // Half past four is still in time.
      const untilFour = { activities: [stop("Fort", "landmark", "08:00", 490)] };
      expect(timed(withStopAt(untilFour, stop("Museum", "museum", "10:00", 60), DAYTIME))).toEqual(["08:00 Fort", "16:30 Museum"]);
      // And a sight planned for half past four is one of the day's: it isn't pushed on from there.
      const atHalfPast = { activities: [stop("Museum", "museum", "16:30", 60)] };
      expect(withStopAt(atHalfPast, stop("Fort", "landmark", "14:00", 180), DAYTIME)).toBeNull();
    });

    it("has no room when a sight would be pushed to run into the evening, however early it starts", () => {
      // After the fort the museum starts at three: three hours end at six, twenty minutes more don't.
      const untilThree = { activities: [stop("Fort", "landmark", "08:00", 400)] };
      expect(timed(withStopAt(untilThree, stop("Museum", "museum", "10:00", 180), DAYTIME))).toEqual(["08:00 Fort", "15:00 Museum"]);
      expect(withStopAt(untilThree, stop("Museum", "museum", "10:00", 200), DAYTIME)).toBeNull();
      // Unasked, it is pushed as before.
      expect(timed(withStopAt(untilThree, stop("Museum", "museum", "10:00", 200)))).toEqual(["08:00 Fort", "15:00 Museum"]);
    });

    it("still pushes a show, shops, a meal a little, or a sight the plan already had in the evening", () => {
      const fort = stop("Fort", "landmark", "14:00", 180);
      const show = {
        activities: [stop("Lunch place", "restaurant", "12:30", 60), stop("Puppet show", "entertainment", "16:00", 120), stop("Dinner place", "restaurant", "19:00", 90)],
      };
      expect(timed(withStopAt(show, fort, DAYTIME))).toEqual(["12:30 Lunch place", "14:00 Fort", "17:20 Puppet show", "19:40 Dinner place"]);
      const shops = { activities: [stop("Old town shops", "shopping", "16:00", 60)] };
      expect(timed(withStopAt(shops, fort, DAYTIME))).toEqual(["14:00 Fort", "17:20 Old town shops"]);
      const sunset = { activities: [stop("Viewpoint", "attraction", "18:00", 60)] };
      expect(timed(withStopAt(sunset, stop("Harbour cruise", "tour", "17:30", 90), DAYTIME))).toEqual(["17:30 Harbour cruise", "19:20 Viewpoint"]);
    });

    it("has no room when a meal would land well past its hour and can't be brought forward", () => {
      const fort = stop("Fort", "landmark", "14:00", 180);
      // A late lunch at half past three would start at twenty past five.
      const lateLunch = { activities: [stop("Late lunch", "restaurant", "15:30", 60)] };
      expect(withStopAt(lateLunch, fort, DAYTIME)).toBeNull();
      expect(timed(withStopAt(lateLunch, fort))).toEqual(["14:00 Fort", "17:20 Late lunch"]);

      const day = {
        activities: [stop("Tomb", "landmark", "10:00", 150), stop("Lunch place", "restaurant", "12:30", 60), stop("Garden", "park", "15:00", 60)],
      };
      const morning = stop("Fort", "landmark", "09:00", 180);
      // Lunch ahead of the tomb would start the garden at 16:40; left behind it, lunch is at ten past three.
      expect(withStopAt(day, morning, DAYTIME)).toBeNull();
      // Unasked, lunch keeps its hour and the garden goes later.
      expect(timed(withStopAt(day, morning))).toEqual(["09:00 Fort", "12:30 Lunch place", "13:50 Tomb", "16:40 Garden"]);
    });

    it("is only for the caller that asks: without it a sight is pushed as before", () => {
      const untilFive = { activities: [stop("Fort", "landmark", "08:00", 520)] };
      expect(timed(withStopAt(untilFive, stop("Museum", "museum", "10:00", 60)))).toEqual(["08:00 Fort", "17:00 Museum"]);
    });

    it("never pushes on a museum the plan had late in the day, but leaves it where it is", () => {
      const day = {
        activities: [
          stop("The Anchor Bankside", "restaurant", "13:30", 90),
          stop("Royal Observatory Greenwich", "museum", "16:45", 60),
          stop("The Grapes", "restaurant", "19:30", 120),
        ],
      };
      // Two and a half hours from twenty past three would start the Observatory at ten past six, after it shuts.
      const va = stop("Victoria and Albert Museum", "museum", "15:20", 150);
      expect(withStopAt(day, va, DAYTIME)).toBeNull();
      // Not even five minutes on.
      expect(withStopAt(day, stop("Borough Market", "market", "15:20", 70), DAYTIME)).toBeNull();
      // A stop that leaves it in place is fine: its time is the plan's to give.
      expect(timed(withStopAt(day, stop("Borough Market", "market", "15:20", 60), DAYTIME))).toEqual([
        "13:30 The Anchor Bankside",
        "15:20 Borough Market",
        "16:45 Royal Observatory Greenwich",
        "19:30 The Grapes",
      ]);
      // Unasked, it is pushed as before.
      expect(timed(withStopAt(day, va))).toEqual([
        "13:30 The Anchor Bankside",
        "15:20 Victoria and Albert Museum",
        "18:10 Royal Observatory Greenwich",
        "19:30 The Grapes",
      ]);
    });
  });

  it("goes ahead of as few stops as it takes", () => {
    const day = {
      activities: [
        stop("Tomb", "landmark", "09:00", 60),
        stop("Garden", "park", "10:30", 60),
        stop("Lunch place", "restaurant", "12:00", 60),
      ],
    };
    // In order: tomb 11:20, garden 12:40, lunch 14:00 (two hours late). One place ahead is enough.
    expect(timed(withStopAt(day, MORNING_SIGHT))).toEqual(["08:00 Taj Mahal", "11:20 Tomb", "12:40 Lunch place", "14:00 Garden"]);
  });

  it("goes ahead of two stops when one isn't enough", () => {
    const day = {
      activities: [stop("Tomb", "landmark", "09:00", 60), stop("Garden", "park", "10:00", 60), stop("Lunch place", "restaurant", "11:00", 60)],
    };
    // One place ahead, lunch would still start at 12:40, an hour and forty minutes late.
    expect(timed(withStopAt(day, MORNING_SIGHT))).toEqual(["08:00 Taj Mahal", "11:20 Lunch place", "12:40 Tomb", "14:00 Garden"]);
  });

  it("leaves a meal pushed an hour and a half or less in its place", () => {
    const day = { activities: [stop("Tomb", "landmark", "10:00", 120), stop("Lunch place", "restaurant", "13:00", 60)] };
    // The tomb goes to 11:20 and ends 13:20: lunch at 13:40, forty minutes late.
    expect(timed(withStopAt(day, MORNING_SIGHT))).toEqual(["08:00 Taj Mahal", "11:20 Tomb", "13:40 Lunch place"]);
  });

  it("never takes a meal past the stop put in, or past another meal", () => {
    const afterSight = { activities: [stop("Lunch place", "restaurant", "09:00", 60)] };
    expect(timed(withStopAt(afterSight, MORNING_SIGHT))).toEqual(["08:00 Taj Mahal", "11:20 Lunch place"]);

    const twoMeals = {
      activities: [stop("Breakfast cafe", "cafe", "09:00", 60), stop("Lunch place", "restaurant", "10:00", 60)],
    };
    expect(timed(withStopAt(twoMeals, MORNING_SIGHT))).toEqual(["08:00 Taj Mahal", "11:20 Breakfast cafe", "12:40 Lunch place"]);
  });

  it("keeps the rest of the day as the plan had it once a stop needn't move", () => {
    // The plan's own overlap later in the day isn't this step's to change.
    const day = { activities: [stop("Garden", "park", "15:00", 120), stop("Museum", "museum", "16:00", 60)] };
    expect(timed(withStopAt(day, MORNING_SIGHT))).toEqual(["08:00 Taj Mahal", "15:00 Garden", "16:00 Museum"]);
  });

  it("has no room when a stop would start after ten at night, or a dated event would move", () => {
    const late = {
      activities: [stop("Fort", "landmark", "10:00", 300), stop("Night market", "market", "16:00", 330), stop("Bar", "bar", "21:30", 60)],
    };
    expect(withStopAt(late, MORNING_SIGHT)).toBeNull();
    const event = { activities: [stop("Show", "event", "10:00", 60), stop("Lunch place", "restaurant", "12:00", 60)] };
    expect(withStopAt(event, MORNING_SIGHT)).toBeNull();
  });

  describe("notBefore", () => {
    it("starts a stop at the opening when it would start before it, in the right part of the day", () => {
      expect(notBefore(stop("Tower", "landmark", "09:30", 180), 600)).toEqual({ ...stop("Tower", "landmark", "10:00", 180), time_slot: "morning" });
      expect(notBefore(stop("Garden", "park", "11:30", 60), 13 * 60)).toEqual({ ...stop("Garden", "park", "13:00", 60), time_slot: "afternoon" });
    });

    it("leaves a stop that starts at or after the opening, with no opening, or with no time as it is", () => {
      const tower = stop("Tower", "landmark", "10:00", 180);
      expect(notBefore(tower, 600)).toBe(tower);
      expect(notBefore(tower)).toBe(tower);
      const untimed = { name: "Walk", type: "walk" };
      expect(notBefore(untimed, 600)).toBe(untimed);
    });
  });

  describe("shortenedToFit", () => {
    const museum = (start: string, minutes: number) => stop("V&A", "museum", start, minutes);

    it("leaves a visit that fits as it is", () => {
      const fits = museum("14:00", 90);
      expect(shortenedToFit(fits, [stop("Tower Bridge", "landmark", "15:50", 60)])).toBe(fits);
    });

    it("cuts a visit to end a walk before the next stop, in whole five minutes", () => {
      expect(shortenedToFit(museum("14:00", 150), [stop("Lunch", "restaurant", "12:30", 60), stop("Tower Bridge", "landmark", "15:52", 60)])).toEqual(
        museum("14:00", 90)
      );
    });

    it("cuts it by the evening when nothing follows", () => {
      expect(shortenedToFit(museum("15:50", 150), [stop("Lunch", "restaurant", "12:30", 60)])).toEqual(museum("15:50", 130));
      expect(shortenedToFit(museum("15:50", 150), [stop("Dinner", "restaurant", "19:30", 90)])).toEqual(museum("15:50", 130));
      // By six even where the place stays open late (the V&A on a Friday, until ten).
      expect(shortenedToFit(museum("15:50", 150), [], 22 * 60)).toEqual(museum("15:50", 130));
    });

    it("cuts it by its place's closing when that comes first", () => {
      expect(shortenedToFit(museum("14:00", 150), [], 17 * 60 + 45)).toEqual(museum("14:00", 150));
      expect(shortenedToFit(museum("14:00", 150), [], 16 * 60 + 30)).toEqual(museum("14:00", 150));
      expect(shortenedToFit(museum("14:00", 150), [], 16 * 60)).toEqual(museum("14:00", 120));
    });

    it("keeps an hour and half the visit at least, or gives up", () => {
      // Half of three hours is ninety minutes: eighty-five isn't enough.
      expect(shortenedToFit(museum("14:00", 180), [stop("Bridge", "landmark", "15:45", 60)])).toBeNull();
      expect(shortenedToFit(museum("14:00", 180), [stop("Bridge", "landmark", "15:50", 60)])).toEqual(museum("14:00", 90));
      // Half of a hundred minutes is fifty, but an hour is the least.
      expect(shortenedToFit(museum("14:00", 100), [stop("Bridge", "landmark", "15:20", 60)])).toEqual(museum("14:00", 60));
      expect(shortenedToFit(museum("14:00", 100), [stop("Bridge", "landmark", "15:15", 60)])).toBeNull();
      expect(shortenedToFit({ name: "No time", type: "museum" }, [])).toBeNull();
    });
  });

  it("counts a stop with no length as an hour and a half", () => {
    expect(plannedMinutes({ activities: [stop("Fort", "landmark", "09:00", 120), { name: "Walk", start_time: "12:00" }] })).toBe(210);
    expect(timed(withStopAt({ activities: [{ name: "Walk", type: "walk", start_time: "07:00" }] }, MORNING_SIGHT))).toEqual([
      "07:00 Walk",
      "08:50 Taj Mahal",
    ]);
  });
});
