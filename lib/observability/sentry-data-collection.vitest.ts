import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { SENTRY_DATA_COLLECTION } from "./sentry-data-collection";

/**
 * The SDK collects user fields, cookies, headers, bodies and local variables
 * unless told otherwise, so every runtime must pass the restrictive settings.
 */

describe("SENTRY_DATA_COLLECTION", () => {
  it("collects nothing about the person", () => {
    expect(SENTRY_DATA_COLLECTION).toMatchObject({
      userInfo: false,
      cookies: false,
      httpHeaders: { allow: ["user-agent", "referer"] },
      httpBodies: [],
      stackFrameVariables: false,
      databaseQueryData: false,
      queues: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      mcp: { inputs: false, outputs: false },
    });
  });

  it.each(["instrumentation-client.ts", "sentry.server.config.ts", "sentry.edge.config.ts"])(
    "is what %s passes to Sentry.init",
    (file) => {
      const source = readFileSync(file, "utf8");
      expect(source.match(/dataCollection: SENTRY_DATA_COLLECTION,/g)).toHaveLength(1);
      expect(source).not.toMatch(/dataCollection: \{/);
    }
  );
});
