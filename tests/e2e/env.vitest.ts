// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { envVar } from "./env";

/**
 * The E2E specs' settings: the environment first (CI), else the developer's
 * .env.local, read the way it is written there.
 */

const dir = mkdtempSync(join(tmpdir(), "e2e-env-"));
let n = 0;
const file = (text: string) => {
  const path = join(dir, `env-${n++}`);
  writeFileSync(path, text);
  return path;
};

afterEach(() => {
  delete process.env.E2E_ENV_TEST;
});

describe("envVar", () => {
  it("takes the environment's value over the file's", () => {
    process.env.E2E_ENV_TEST = "from-env";
    expect(envVar("E2E_ENV_TEST", file("E2E_ENV_TEST=from-file\n"))).toBe("from-env");
  });

  it("reads the file when the environment has no value, or an empty one", () => {
    const path = file("E2E_ENV_TEST=from-file\n");
    expect(envVar("E2E_ENV_TEST", path)).toBe("from-file");
    process.env.E2E_ENV_TEST = "";
    expect(envVar("E2E_ENV_TEST", path)).toBe("from-file");
  });

  it("reads quoted values, spaces around the sign, Windows line ends, and the last of a key set twice", () => {
    const path = file('A_KEY="quoted"\r\n  B_KEY = spaced  \r\nC_KEY=\'single\'\nC_KEY=later\n# D_KEY=commented\n');
    expect([envVar("A_KEY", path), envVar("B_KEY", path), envVar("C_KEY", path), envVar("D_KEY", path)]).toEqual([
      "quoted",
      "spaced",
      "later",
      "",
    ]);
  });

  it("is empty when neither has it, as when the file is missing", () => {
    expect(envVar("E2E_ENV_TEST", join(dir, "missing"))).toBe("");
  });
});
