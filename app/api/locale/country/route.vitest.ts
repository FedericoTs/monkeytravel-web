import { afterEach, describe, expect, it, vi } from "vitest";

let geo: { country?: string } = {};
vi.mock("@vercel/functions", () => ({ geolocation: () => geo }));

import { GET } from "./route";

afterEach(() => {
  geo = {};
});

describe("the visitor's country", () => {
  it("is the country the network places them in, kept by no one", async () => {
    geo = { country: "IN" };
    const response = GET(new Request("https://monkeytravel.app/api/locale/country"));
    expect(await response.json()).toEqual({ country: "IN" });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("is none when the network doesn't say, or says something that isn't a country code", async () => {
    expect(await GET(new Request("https://monkeytravel.app/api/locale/country")).json()).toEqual({ country: null });
    geo = { country: "in" };
    expect(await GET(new Request("https://monkeytravel.app/api/locale/country")).json()).toEqual({ country: null });
  });
});
