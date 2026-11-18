import { describe, expect, it } from "vitest";
import { mendJson } from "./json-mend";

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
    // Nor a name left unquoted.
    expect(() => mendJson('{"a":1, b:2}')).toThrow(/Expected double-quoted property name/);
  });

  it("takes out a stray character or scrap typed before a value, found by the text the parser quotes", () => {
    expect(lastDay(long('{"n":99,   "type":="market","x":1}'))).toEqual({ n: 99, type: "market", x: 1 });
    expect(lastDay(long('{"n":98,"address":amp; "Main St","x":2}'))).toEqual({ n: 98, address: "Main St", x: 2 });
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

  it("gives up on a reply with more slips than a slip", () => {
    const many = tips(Array.from({ length: 11 }, (_, i) => `"Try "the" ${i}"`).join(","));
    expect(() => mendJson(many)).toThrow(SyntaxError);
    const some = tips(Array.from({ length: 10 }, (_, i) => `"Try "the" ${i}"`).join(","));
    expect(mendJson(some).mends).toBe(20);
  });
});
