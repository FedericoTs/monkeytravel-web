import { describe, expect, it } from "vitest";
import { closeMatches } from "./close-matches";

const PLACES = [
  { name: "Paris", country: "France" },
  { name: "Kuala Lumpur", country: "Malaysia" },
  { name: "Bangkok", country: "Thailand" },
  { name: "Phuket", country: "Thailand" },
  { name: "Barcelona", country: "Spain" },
  { name: "Rome", country: "Italy" },
];
const fold = (text: string) => text.toLowerCase();
const names = (typed: string) => closeMatches(typed, PLACES, fold).map((place) => place.name);

describe("closeMatches", () => {
  it.each([
    ["KUALUMPUR", ["Kuala Lumpur"]],
    ["Kualalumpur", ["Kuala Lumpur"]],
    ["Pariss", ["Paris"]],
    ["Bankok", ["Bangkok"]],
    ["Barcelonna", ["Barcelona"]],
  ])("reads %s as the place it nearly spells", (typed, expected) => {
    expect(names(typed)).toEqual(expected);
  });

  it("counts two letters swapped as one mistake", () => {
    expect(names("Pairs")).toEqual(["Paris"]);
  });

  it("reads a misspelled country as its places, in the order given", () => {
    expect(names("Tailand")).toEqual(["Bangkok", "Phuket"]);
  });

  it("puts a name ahead of a country, and the nearer name first", () => {
    const places = [
      { name: "Salzburg", country: "Austria" },
      { name: "Salsburg", country: "Austria" },
      { name: "Vienna", country: "Salzbury" },
    ];
    expect(closeMatches("Salsburg", places, fold).map((place) => place.name)).toEqual(["Salsburg", "Salzburg", "Vienna"]);
  });

  it("lists a place once when its name and its country are both close", () => {
    const places = [{ name: "Singapore", country: "Singapore" }];
    expect(closeMatches("Singapor", places, fold)).toEqual(places);
  });

  it("forgives nothing in a short word, where one edit makes another place", () => {
    expect(names("Rame")).toEqual([]);
    expect(names("Rom")).toEqual([]);
  });

  it("forgives one mistake up to 7 letters and two from 8", () => {
    expect(names("Pariis")).toEqual(["Paris"]);
    expect(names("Parisss")).toEqual([]);
    expect(names("Bangkokk")).toEqual(["Bangkok"]);
    expect(names("Barcelonnna")).toEqual(["Barcelona"]);
    expect(names("Barcelonnnna")).toEqual([]);
  });

  it("doesn't read a real place as a near one", () => {
    expect(names("Parma")).toEqual([]);
    expect(names("Perth")).toEqual([]);
  });

  it("ignores spaces and uses the fold it's given", () => {
    expect(names("kuala  lumpurr")).toEqual(["Kuala Lumpur"]);
    const accents = (text: string) => text.toLowerCase().replace("á", "a");
    expect(closeMatches("Bárcelonna", PLACES, accents).map((place) => place.name)).toEqual(["Barcelona"]);
  });
});
