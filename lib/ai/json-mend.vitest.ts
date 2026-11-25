import { describe, expect, it } from "vitest";
import { mendJson, slipNear } from "./json-mend";

const tips = (body: string) => `{"day":1,"tips":[${body}],"theme":"Old town"}`;
// A reply long enough that the parser quotes only the text around a token it can't take.
const long = (last: string) => `{"days":[${Array.from({ length: 30 }, (_, i) => `{"n":${i},"type":"museum"}`).join(",")},${last}]}`;
const lastDay = (text: string) => (mendJson(text).value as { days: unknown[] }).days.at(-1);

describe("mendJson", () => {
  it("leaves JSON that parses as it is", () => {
    expect(mendJson('{"a":"say \\"hi\\"","b":[1,2]}')).toEqual({ value: { a: 'say "hi"', b: [1, 2] }, mends: 0 });
  });

  it("escapes a quote left inside a string, in a list or a value", () => {
    expect(mendJson(tips('"Try the "best" coffee","Go early"'))).toEqual({
      value: { day: 1, tips: ['Try the "best" coffee', "Go early"], theme: "Old town" },
      mends: 2,
    });
    expect(mendJson('{"name":"Rick\'s "Café" Americain","stars":4}').value).toEqual({ name: 'Rick\'s "Café" Americain', stars: 4 });
    // A quote that opens the string's words.
    expect(mendJson('{"name":""The Nest" bar","x":1}').value).toEqual({ name: '"The Nest" bar', x: 1 });
  });

  it("puts back a comma left out between two items", () => {
    expect(mendJson('{"days":[{"n":1}{"n":2}]}')).toEqual({ value: { days: [{ n: 1 }, { n: 2 }] }, mends: 1 });
    expect(mendJson('{"a":"x" "b":"y"}').value).toEqual({ a: "x", b: "y" });
    expect(mendJson('{"tips":["one" "two"],"more":[[1] [2]]}').value).toEqual({ tips: ["one", "two"], more: [[1], [2]] });
  });

  it("writes a line break, a tab or another control character typed inside a string as its escape", () => {
    expect(mendJson('{"tip":"Book ahead.\nGo early","note":"a\tb"}')).toEqual({
      value: { tip: "Book ahead.\nGo early", note: "a\tb" },
      mends: 2,
    });
    expect(mendJson('{"a":"x\r\ny"}').value).toEqual({ a: "x\r\ny" });
    expect(mendJson('{"a":"x\u0001y"}').value).toEqual({ a: "x\u0001y" });
    // Outside a string it is no slip of this kind.
    expect(() => mendJson('{"a":1\u0001}')).toThrow(SyntaxError);
  });

  it("takes out a comma left before the end of an object", () => {
    expect(mendJson('{"a":1,}')).toEqual({ value: { a: 1 }, mends: 1 });
    expect(mendJson('{"days":[{"n":1,  }],"x":2}').value).toEqual({ days: [{ n: 1 }], x: 2 });
    // Only a comma: a name left without its colon stays the parser's error.
    expect(() => mendJson('{"a" }')).toThrow(/after property name in JSON at position 5 \(line 1 column 6\)$/);
  });

  it("puts back the quotes of a name typed without them, a stray character before it taken out", () => {
    // Read live: a day's activities named with a dollar and no quotes.
    const live = '{"theme":"Culture and Urban Neighborhoods",\n      $activities: [\n        {"start_time":"09:00"}]}';
    expect(mendJson(live)).toEqual({ value: { theme: "Culture and Urban Neighborhoods", activities: [{ start_time: "09:00" }] }, mends: 1 });
    expect(mendJson('{"a":1, b:2}').value).toEqual({ a: 1, b: 2 });
    expect(mendJson('{ day_number : 3 }').value).toEqual({ day_number: 3 });
    // Two stray characters, a name that starts with a digit, or no colon after it: the parser's error, nothing mended.
    const untouched = /^Expected double-quoted property name in JSON at position 8 \(line 1 column 9\)$/;
    expect(() => mendJson('{"a":1, $$b:2}')).toThrow(untouched);
    expect(() => mendJson('{"a":1, 2b:2}')).toThrow(untouched);
    expect(() => mendJson('{"a":1, b 2}')).toThrow(untouched);
  });

  it("takes out a stray character or scrap typed before a value, found by the text the parser quotes", () => {
    expect(lastDay(long('{"n":99,   "type":="market","x":1}'))).toEqual({ n: 99, type: "market", x: 1 });
    expect(lastDay(long('{"n":98,"address":amp; "Main St","x":2}'))).toEqual({ n: 98, address: "Main St", x: 2 });
  });

  it("ends a list before a name and its value typed inside it, taking out the list's end left after the value", () => {
    // Read live: a plan's tips left open, the stop's next field typed inside them, the tips' end after its value.
    const live = '{"activities":[{"name":"Xcaret Park","tips":["Bring cash","Stay for the illuminated lagoon.", "booking_required": true]\n        }\n      ]}';
    expect(mendJson(live)).toEqual({
      value: { activities: [{ name: "Xcaret Park", tips: ["Bring cash", "Stay for the illuminated lagoon."], booking_required: true }] },
      mends: 1,
    });
    // The value a string or a number, with the list's end after it or not.
    expect(mendJson('{"tips":["a", "note": "go early"]}').value).toEqual({ tips: ["a"], note: "go early" });
    expect(mendJson('{"tips":["a", "cost": 12.5]}').value).toEqual({ tips: ["a"], cost: 12.5 });
    expect(mendJson('{"tips":["a","b", "cost": 12, "x": 1}').value).toEqual({ tips: ["a", "b"], cost: 12, x: 1 });
    // A name with a quote in it.
    expect(mendJson('{"tips":["a", "the \\"best\\" time": "dawn"]}').value).toEqual({ tips: ["a"], 'the "best" time': "dawn" });
    // A colon after a value in an object is no list's: the parser's error, nothing mended.
    expect(() => mendJson('{"a": "x": 1}')).toThrow(/^Expected ',' or '\}' after property value in JSON at position 9 \(line 1 column 10\)$/);
  });

  it("ends a list empty when the name and its value were typed as its first item", () => {
    // Read live: a stop's tips opened, the stop's next field typed as their only item, the tips' end after its value.
    const live = '{"activities":[{"name":"Xcaret Park","tips": [\n            "booking_required": true\n          ]\n        }\n      ]}';
    expect(mendJson(live)).toEqual({
      value: { activities: [{ name: "Xcaret Park", tips: [], booking_required: true }] },
      mends: 1,
    });
    expect(mendJson('{"tips":["note": 1]}').value).toEqual({ tips: [], note: 1 });
    expect(mendJson('{"tips":[ "note": "go early", "x": 2}').value).toEqual({ tips: [], note: "go early", x: 2 });
  });

  it("takes out a comma left before the end of a list in a long reply", () => {
    expect(lastDay(long('{"tags":["a","b",]}'))).toEqual({ tags: ["a", "b"] });
  });

  it("leaves a stray token as the parser's error where it can't tell the place or the value", () => {
    // Short: the parser quotes the whole reply, so the place can't be told.
    expect(() => mendJson('{"a":=1}')).toThrow(/Unexpected token '='/);
    // Before a number the run could be the start of a garbled string, so it stays.
    expect(() => mendJson(long('{"floor":ab 4,"x":1}'))).toThrow(/Unexpected token/);
    // A longer run before a value is no slip.
    expect(() => mendJson(long('{"note":abcdefghij "x","y":1}'))).toThrow(/Unexpected token/);
    // The quoted text is in the reply twice: which one can't be told.
    expect(() => mendJson(long('{"n":1,   "type":="a"},{"n":2,   "type":="b"}'))).toThrow(/Unexpected token '='/);
  });

  it("names the slip it couldn't mend after mending the ones before it", () => {
    const reply = '{"tip":"Try the "best" coffee","address":ოფ Flat 4}';
    expect(() => mendJson(reply)).toThrow(/^Expected ',' or '\}' after property value in JSON at position 17 .*; 2 mended, then: Unexpected token 'ო'/);
  });

  it("throws the parser's first error when the text is broken some other way", () => {
    const stray = '{"address":ოფ Flat 4,"x":1}';
    expect(() => mendJson(stray)).toThrow(/Unexpected token/);
    // A quote followed by a comma can't be told from the end of the string.
    expect(() => mendJson('{"d":"a "b", c","x":1}')).toThrow(/after property value in JSON at position 9/);
    // A comma before the end of a list in a reply too short for the parser to quote around it.
    expect(() => mendJson("[1,]")).toThrow(SyntaxError);
  });

  // A plan that couldn't be read logged only the parser's words ("Expected double-quoted property name ... line 337
  // column 7"), so the slip couldn't be taught.
  it("keeps the text around the slip it couldn't mend, on one line, for the logs", () => {
    const caught = (text: string): unknown => {
      try {
        mendJson(text);
      } catch (err) {
        return err;
      }
      throw new Error("it parsed");
    };
    // A number right after a number: no comma it can put back.
    expect(slipNear(caught('{"a":[1 2]}'))).toBe('{"a":[1 ⟪2]}');
    // A name that starts with a digit at the start of a line, the line break written as its escape.
    expect(slipNear(caught('{"a":1,\n      2x: 2}'))).toBe('{"a":1,\\n      ⟪2x: 2}');
    // After the slips it mended, the text as mended, around the one that stopped it.
    expect(slipNear(caught('{"tip":"Try the "best" coffee","address":ოფ Flat 4}'))).toBe('ip":"Try the \\"best\\" coffee","address":⟪ოფ Flat 4}');
    // Forty characters on each side, no more.
    expect(slipNear(caught(`{"a":"${"x".repeat(100)}","b":[1 2]}`))).toBe(`${"x".repeat(31)}","b":[1 ⟪2]}`);
    expect(slipNear(caught(`{"b":[1 2],"c":"${"y".repeat(100)}"}`))).toBe(`{"b":[1 ⟪2],"c":"${"y".repeat(32)}`);
    // No place for the parser's error, or another error: nothing.
    expect(slipNear(caught('{"a":'))).toBeNull();
    expect(slipNear(new Error("timeout"))).toBeNull();
    expect(slipNear("not an error")).toBeNull();
  });

  it("gives up on a reply with more slips than a slip", () => {
    const many = tips(Array.from({ length: 11 }, (_, i) => `"Try "the" ${i}"`).join(","));
    expect(() => mendJson(many)).toThrow(SyntaxError);
    const some = tips(Array.from({ length: 10 }, (_, i) => `"Try "the" ${i}"`).join(","));
    expect(mendJson(some).mends).toBe(20);
  });
});
