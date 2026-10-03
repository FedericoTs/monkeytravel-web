import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { AUTHORS } from "./authors";

describe("author photos", () => {
  it("every photo an author sets exists under public/", () => {
    const missing = AUTHORS.filter((a) => a.photo && !existsSync(join(process.cwd(), "public", a.photo))).map(
      (a) => a.slug,
    );
    expect(missing).toEqual([]);
  });
});
