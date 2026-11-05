import { describe, expect, it } from "vitest";
import { buildStaticChatHistory } from "./trip-prompt";

/**
 * Left alone, 3.5 Flash-Lite writes short descriptions and ends most days at
 * lunch, so the prompt every plan shares asks for both.
 */
describe("what every plan is asked for", () => {
  const spec = buildStaticChatHistory("system")[0].parts[0].text;

  it("has lunch and dinner on every full day, at real places", () => {
    expect(spec).toMatch(/every full day has lunch, and dinner in the evening, at real named places/i);
  });

  it("describes each stop with why it is worth it", () => {
    expect(spec).toMatch(/"description": "What to do here and why it is worth it, in about 25 words"/);
  });
});
