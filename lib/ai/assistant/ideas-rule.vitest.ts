import { describe, expect, it } from "vitest";
import { buildPrompt } from "./edit-prompt";
import { chatPrompt } from "./chat-prompt";
import { IDEAS_RULE, offeredAgain, placeNames, turnsDown } from "./ideas-rule";
import { correctionWithRule } from "./engine";

/**
 * A traveller asked for an activity, said "none of those" to three museums,
 * asked for "anything indoors?" and got the same three museums again, then
 * more lists they called boring. The assistant had no rule about ideas the
 * traveller had already turned down, and nothing told it which ones they were.
 */

const days = [{ day_number: 1, date: "2027-03-01", activities: [] }];
const offer = "Try the Tile Museum, the Gulbenkian or the Oceanarium. Want me to add one?";
const asked = { role: "user" as const, text: "can you find an activity in Lisbon" };
const offered = { role: "assistant" as const, text: offer };
const prompt = (message: string, history: { role: "user" | "assistant"; text: string }[]) =>
  buildPrompt({ message, destination: "Lisbon", tripTitle: "Lisbon Trip", days, history });

describe("turnsDown", () => {
  it.each([
    "none of those",
    "none of those, can you give more",
    "none of those… those are so boring",
    "No something else",
    "nope, not those",
    "neither",
    "no thanks",
    "other ideas?",
    "ninguna de esas",
    "otra cosa por favor",
    "nessuna di queste",
    "qualcos'altro?",
    "nenhuma dessas",
    "outra coisa",
    "those are boring",
    "que aburrido",
    "che noia, sono noiosi",
    "que chato",
  ])("hears %j as turning down what was just offered", (message) => {
    expect(turnsDown(message)).toBe(true);
  });

  it.each([
    "anything indoors?",
    "can you swap the shopping mall for something else",
    "No I mean the one in Sintra",
    "no, the bakery in Belém",
    "add a cooking class on day 2",
    "the museum on day 2 is boring but keep it, my friend loves it and we really want to go",
    "is there something open late?",
  ])("doesn't hear %j as turning ideas down", (message) => {
    expect(turnsDown(message)).toBe(false);
  });
});

describe("ideas the traveller turned down", () => {
  it("stay out of every later answer, with the trip's own kind of ideas and a question instead", () => {
    expect(IDEAS_RULE).toContain("never offer them again, nor anything already in their plan");
    expect(IDEAS_RULE).toContain("however they ask next");
    expect(IDEAS_RULE).toContain("fit this trip: who's travelling and why");
    expect(IDEAS_RULE).toContain("the kind of places already in their plan");
    expect(IDEAS_RULE).toContain("end with one short question about what they'd enjoy");
  });

  it("are a rule of the edit engine", () => {
    expect(prompt("anything indoors?", [asked, offered])).toContain(`- ${IDEAS_RULE}`);
  });

  it("are a rule of the chat too", () => {
    const tripContext = { id: "t", title: "Lisbon Trip", destination: "Lisbon", startDate: "2027-03-01", endDate: "2027-03-01", itinerary: days, dayCount: 1, activityCount: 0 };
    expect(chatPrompt({ tripContext, language: "en", turn: "", thread: [], message: "anything indoors?" })).toContain(`- ${IDEAS_RULE}`);
  });

  it("mark the reply the traveller turned down, so a new question doesn't bring its places back", () => {
    const text = prompt("anything indoors?", [asked, offered, { role: "user", text: "none of those" }, { role: "assistant", text: "No problem! A spa, maybe?" }]);
    expect(text).toContain(`You [turned down]: ${offer}`);
    expect(text).toContain("You: No problem! A spa, maybe?");
    expect(text).toContain("The traveller turned down the places in your replies marked [turned down]: never offer any of them again.");
  });

  it("mark the last reply when the new message turns it down", () => {
    const text = prompt("none of those, can you give more", [asked, offered]);
    expect(text).toContain(`You [turned down]: ${offer}`);
    expect(text).toContain("never offer any of them again");
  });

  it("mark nothing when the traveller just asks on", () => {
    const text = prompt("anything indoors?", [asked, offered]);
    expect(text).toContain(`You: ${offer}`);
    expect(text).not.toContain("[turned down]");
  });
});

describe("placeNames", () => {
  it("reads the places a reply names, not its other capitalised words", () => {
    const reply =
      "Here are a few fantastic activities in Lisbon you can add: visiting the Calouste Gulbenkian Museum next to the park, the National Tile Museum (MuDe), or a ride on Tram 28 to the Castelo de São Jorge. Let me know if you would like me to add one!";
    expect(placeNames(reply, "Lisbon, Portugal")).toEqual(["Calouste Gulbenkian Museum", "National Tile Museum", "MuDe", "Castelo de São Jorge"]);
  });

  it("leaves out runs made only of the destination's words or the calendar", () => {
    expect(placeNames("Plans for Lisbon and Porto on Saturday and Sunday, Day 2.", "Lisbon & Porto")).toEqual([]);
  });

  it("keeps a name's own possessive out", () => {
    expect(placeNames("the Lisbon Public Library's reading room", "Lisbon")).toEqual(["Lisbon Public Library"]);
  });

  it("keeps a verb or an article before a name out of it", () => {
    expect(placeNames("Try the Calouste Gulbenkian Museum.", "Lisbon")).toEqual(["Calouste Gulbenkian Museum"]);
    expect(placeNames("Visiting Calouste Gulbenkian Museum is a must.", "Lisbon")).toEqual(["Visiting Calouste Gulbenkian Museum", "Calouste Gulbenkian Museum"]);
    expect(placeNames("The Pink Door and the Tile Museum", "Lisbon")).toEqual(["Pink Door", "Tile Museum"]);
  });

  it("reads two places joined by \"and\" as each one too, and keeps an article after \"of\"", () => {
    expect(placeNames("near the Belém Tower and Jerónimos Monastery", "Lisbon")).toEqual(["Belém Tower and Jerónimos Monastery", "Belém Tower", "Jerónimos Monastery"]);
    expect(placeNames("the Museum of the Orient, by the river", "Lisbon")).toEqual(["Museum of the Orient"]);
    expect(placeNames("the National Museum of the city", "Lisbon")).toEqual(["National Museum"]);
    expect(placeNames("Museum of Ancient Art is a must.", "Lisbon")).toEqual(["Museum of Ancient Art", "Ancient Art"]);
  });
});

describe("offeredAgain", () => {
  const plan = [{ day_number: 1, date: "2027-03-01", activities: [{ name: "Belém Tower" }] }] as never;
  const list = { role: "assistant" as const, text: "Try the Calouste Gulbenkian Museum, the National Tile Museum or the Belém Tower. Want one?" };
  const turnedDownList = [asked, list, { role: "user" as const, text: "none of those" }, { role: "assistant" as const, text: "A spa, maybe?" }];
  const input = (message: string, history = turnedDownList) => ({ message, history, days: plan, destination: "Lisbon" });

  it("finds a turned-down place offered again under another question", () => {
    const again = offeredAgain(input("anything indoors?"), { reply: "Indoors: the National Tile Museum or the Oceanarium.", edits: [] });
    expect(again).toEqual(["National Tile Museum"]);
  });

  it("still finds a place named after the destination when the message names the destination", () => {
    const history = [asked, { role: "assistant" as const, text: "Try the Lisbon Public Library." }, { role: "user" as const, text: "none of those" }];
    expect(offeredAgain(input("anything indoors in Lisbon?", history), { reply: "The Lisbon Public Library is indoors.", edits: [] })).toEqual(["Lisbon Public Library"]);
  });

  it("names a place once, by its whole name", () => {
    const history = [asked, { role: "assistant" as const, text: "How about the Belém Cultural Centre and Garden, or the Tile Museum?" }, { role: "user" as const, text: "neither" }];
    expect(offeredAgain(input("anything indoors?", history), { reply: "Try the Belém Cultural Centre and Garden!", edits: [] })).toEqual(["Belém Cultural Centre and Garden"]);
  });

  it("finds one added as a new stop", () => {
    const edits = [{ activities: [{ name: "Belém Tower" }, { name: "Calouste Gulbenkian Museum" }] }];
    expect(offeredAgain(input("anything indoors?"), { reply: "Added a museum on Day 1.", edits })).toEqual(["Calouste Gulbenkian Museum"]);
  });

  it("finds a place of the last reply when the new message turns it down", () => {
    const again = offeredAgain(input("none of those, more please", [asked, list]), { reply: "How about the Gulbenkian, I mean the Calouste Gulbenkian Museum?", edits: [] });
    expect(again).toEqual(["Calouste Gulbenkian Museum"]);
  });

  it("lets through places of the plan, new places, a place they ask for again, and offers nobody turned down", () => {
    expect(offeredAgain(input("anything indoors?"), { reply: "The Belém Tower on Day 1 has an indoor floor; or try the Oceanarium.", edits: [] })).toEqual([]);
    expect(offeredAgain(input("ok, add the tile museum after all"), { reply: "Added the National Tile Museum to Day 1.", edits: [] })).toEqual([]);
    expect(offeredAgain(input("anything indoors?", [asked, list]), { reply: "The National Tile Museum is indoors.", edits: [] })).toEqual([]);
  });
});

describe("the engine's second try", () => {
  it("is asked for when the answer offers a turned-down place again, naming it", () => {
    const history = [asked, offered, { role: "user" as const, text: "none of those" }];
    const days = [{ day_number: 1, date: "2027-03-01", activities: [] }] as never;
    const correction = correctionWithRule({ message: "anything indoors?", history, days, destination: "Lisbon" }, { reply: "Indoors: the Tile Museum or the Gulbenkian.", edits: [] });
    expect(correction?.rule).toBe("turned_down");
    expect(correction?.text).toContain("turned these down earlier in this conversation: Tile Museum");
    expect(correction?.text).toContain("end \"reply\" with one short question");
    expect(correctionWithRule({ message: "anything indoors?", history, days, destination: "Lisbon" }, { reply: "Indoors: the Oceanarium.", edits: [] })).toBeNull();
  });
});
