import { describe, expect, it } from "vitest";
import { boardOf, cluesInSight, guessState, keyOf, KEYS, keysOf } from "./letters";

/**
 * The letters of the story's guess: a friend picks from A to Z, so an accent is the board's to show and never the
 * friend's to type, and what is no letter stays in sight.
 */

describe("the key that opens a character", () => {
  it("is its plain capital, whatever its accent or case", () => {
    expect(keyOf("a")).toBe("A");
    expect(keyOf("Ã")).toBe("A");
    expect(keyOf("é")).toBe("E");
    expect(keyOf("ñ")).toBe("N");
    expect(keyOf("ç")).toBe("C");
    expect(keyOf("ü")).toBe("U");
  });

  it("is none for what no key has: a space, a hyphen, an apostrophe, a digit, a letter outside A to Z", () => {
    for (const ch of [" ", "-", "'", "’", ".", "3", "ø", "ß", "日"]) expect(keyOf(ch)).toBeNull();
  });

  it("is one of the twenty-six", () => {
    expect(KEYS).toHaveLength(26);
    expect(KEYS[0]).toBe("A");
    expect(KEYS[25]).toBe("Z");
  });
});

describe("the board", () => {
  it("lays the place out a word to a row, in capitals, each letter with its key", () => {
    expect(boardOf("São Paulo", "pt")).toEqual([
      [{ ch: "S", key: "S" }, { ch: "Ã", key: "A" }, { ch: "O", key: "O" }],
      [{ ch: "P", key: "P" }, { ch: "A", key: "A" }, { ch: "U", key: "U" }, { ch: "L", key: "L" }, { ch: "O", key: "O" }],
    ]);
  });

  it("keeps a hyphen and an apostrophe in sight", () => {
    const [word] = boardOf("L'Aquila", "it");
    expect(word.map((tile) => tile.key)).toEqual(["L", null, "A", "Q", "U", "I", "L", "A"]);
    expect(boardOf("Baden-Baden", "en")[0][5]).toEqual({ ch: "-", key: null });
  });

  it("needs each of its letters once, however often it comes", () => {
    expect([...keysOf("São Paulo")].sort()).toEqual(["A", "L", "O", "P", "S", "U"]);
    expect([...keysOf("Ho Chi Minh City")].sort()).toEqual(["C", "H", "I", "M", "N", "O", "T", "Y"]);
  });
});

describe("where a guess stands", () => {
  it("counts the letters that are not in the place", () => {
    expect(guessState("Lisbon", [], 6)).toEqual({ misses: 0, solved: false, lost: false });
    expect(guessState("Lisbon", ["A", "E", "I"], 6)).toEqual({ misses: 2, solved: false, lost: false });
  });

  it("is solved when every letter is open, whatever was missed on the way", () => {
    expect(guessState("Lisbon", ["A", "L", "I", "S", "B", "O", "N"], 6)).toEqual({ misses: 1, solved: true, lost: false });
    expect(guessState("São Paulo", ["S", "A", "O", "P", "U", "L"], 6).solved).toBe(true);
  });

  it("is lost at the last wrong letter allowed, and not before", () => {
    expect(guessState("Lisbon", ["A", "E", "U", "T", "R"], 6).lost).toBe(false);
    expect(guessState("Lisbon", ["A", "E", "U", "T", "R", "M"], 6)).toEqual({ misses: 6, solved: false, lost: true });
  });

  it("is not lost once it is solved", () => {
    const picked = ["A", "E", "U", "T", "R", "L", "I", "S", "B", "O", "N"];
    expect(guessState("Lisbon", picked, 6)).toEqual({ misses: 5, solved: true, lost: false });
  });
});

describe("the clues in sight", () => {
  const after = [0, 1, 2, 4];

  it("start with the first and open one by one as wrong letters add up", () => {
    expect(cluesInSight(4, 0, after)).toBe(1);
    expect(cluesInSight(4, 1, after)).toBe(2);
    expect(cluesInSight(4, 2, after)).toBe(3);
    expect(cluesInSight(4, 3, after)).toBe(3);
    expect(cluesInSight(4, 4, after)).toBe(4);
  });

  it("are never more than there are", () => {
    expect(cluesInSight(2, 5, after)).toBe(2);
    expect(cluesInSight(0, 5, after)).toBe(0);
    expect(cluesInSight(6, 9, after)).toBe(6);
  });
});
