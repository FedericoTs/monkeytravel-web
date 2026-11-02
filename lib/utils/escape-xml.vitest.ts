import { describe, expect, it } from "vitest";
import { escapeXml } from "./escape-xml";

describe("escapeXml", () => {
  it("replaces the five characters XML reserves", () => {
    expect(escapeXml(`Fish & "chips" <for> two's`)).toBe("Fish &amp; &quot;chips&quot; &lt;for&gt; two&apos;s");
  });

  it("escapes an ampersand once, even next to an entity", () => {
    expect(escapeXml("&amp;")).toBe("&amp;amp;");
  });

  it("leaves other text alone", () => {
    expect(escapeXml("Città: 5€ — ok")).toBe("Città: 5€ — ok");
  });
});
