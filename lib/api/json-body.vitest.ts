// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readJsonBody } from "./json-body";

const post = (body: string) => new Request("http://localhost/api/x", { method: "POST", body, headers: { "content-type": "application/json" } });

describe("readJsonBody", () => {
  it("returns the parsed body", async () => {
    const { body, invalidBody } = await readJsonBody<{ code: string }>(post(JSON.stringify({ code: "ABC" })));
    expect(invalidBody).toBeNull();
    expect(body).toEqual({ code: "ABC" });
  });

  it("answers a body of JSON null with a 400, since the first field read from it would throw", async () => {
    const { body, invalidBody } = await readJsonBody(post("null"));
    expect(body).toBeNull();
    expect(invalidBody?.status).toBe(400);
  });

  it("leaves other shapes to the route that knows what it wants", async () => {
    for (const value of [[], 0, "", false]) {
      const { body, invalidBody } = await readJsonBody(post(JSON.stringify(value)));
      expect(invalidBody).toBeNull();
      expect(body).toEqual(value);
    }
  });

  it("answers a body that isn't JSON with a 400, not a 500", async () => {
    for (const raw of ["{not json", ""]) {
      const { body, invalidBody } = await readJsonBody(post(raw));
      expect(body).toBeNull();
      expect(invalidBody?.status).toBe(400);
      expect(await invalidBody?.json()).toMatchObject({ error: "Invalid JSON body" });
    }
  });
});
