import { describe, expect, it } from "vitest";
import { mendJson } from "./json-mend";

const tips = (body: string) => `{"day":1,"tips":[${body}],"theme":"Old town"}`;

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

  it("throws the parser's first error when the text is broken some other way", () => {
    const stray = '{"address":ოფ Flat 4,"x":1}';
    expect(() => mendJson(stray)).toThrow(/Unexpected token/);
    // A quote followed by a comma can't be told from the end of the string.
    expect(() => mendJson('{"d":"a "b", c","x":1}')).toThrow(/after property value in JSON at position 9/);
    expect(() => mendJson('{"a":1,}')).toThrow(SyntaxError);
  });

  it("gives up on a reply with more slips than a slip", () => {
    const many = tips(Array.from({ length: 11 }, (_, i) => `"Try "the" ${i}"`).join(","));
    expect(() => mendJson(many)).toThrow(SyntaxError);
    const some = tips(Array.from({ length: 10 }, (_, i) => `"Try "the" ${i}"`).join(","));
    expect(mendJson(some).mends).toBe(20);
  });
});
