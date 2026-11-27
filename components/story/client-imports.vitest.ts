// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The story's screen runs in the browser. The story's builder, its pictures and its sunset run on the server (the
 * builder reads the destinations data, which is server-only), so the screen may take their types and nothing
 * else: a value imported from one of them breaks the page's build, which no component test sees.
 */

const SERVER_ONLY = ["@/lib/story/trip-story", "@/lib/og/story-slides", "@/lib/story/sunset"];
const dir = join(process.cwd(), "components", "story");

describe("the story's browser code", () => {
  const files = readdirSync(dir).filter((name) => /\.tsx?$/.test(name) && !name.includes(".vitest."));

  it("is looked at", () => {
    expect(files).toEqual(expect.arrayContaining(["TripStoryView.tsx", "StoryPost.tsx"]));
  });

  it.each(files)("%s takes only types from the server's modules", (name) => {
    const source = readFileSync(join(dir, name), "utf8");
    const imports = [...source.matchAll(/^import\s+(type\s+)?[^;]*?from\s+"([^"]+)";/gm)];
    const values = imports.filter(([, typeOnly, from]) => SERVER_ONLY.includes(from) && !typeOnly).map(([, , from]) => from);
    expect(values).toEqual([]);
  });
});
