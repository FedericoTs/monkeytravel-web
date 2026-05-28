import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("getHostelworldSearchUrl", () => {
  const origEnv = process.env;

  beforeEach(() => {
    process.env = { ...origEnv };
    delete process.env.HOSTELWORLD_AWIN_AFFILIATE_ID;
    delete process.env.AWIN_AFFILIATE_ID;
    vi.resetModules();
  });

  afterEach(() => {
    process.env = origEnv;
  });

  it("returns a clean Hostelworld search URL when no affiliate id is set", async () => {
    const { getHostelworldSearchUrl } = await import("./hostelworld");
    const url = getHostelworldSearchUrl({
      destination: "Barcelona, Spain",
      startDate: "2026-07-20",
      endDate: "2026-07-23",
    });
    expect(url).toContain("hostelworld.com/pwa/wds/s");
    expect(url).toContain("search-keyword=Barcelona"); // city only — drops ", Spain"
    expect(url).toContain("date-start=2026-07-20");
    expect(url).toContain("date-end=2026-07-23");
    expect(url).toContain("number-of-guests=1"); // backpacker default
    expect(url).not.toContain("awin1.com"); // no wrap when no affiliate id
  });

  it("wraps the URL in an Awin redirect when HOSTELWORLD_AWIN_AFFILIATE_ID is set", async () => {
    process.env.HOSTELWORLD_AWIN_AFFILIATE_ID = "1234567";
    const { getHostelworldSearchUrl } = await import("./hostelworld");
    const url = getHostelworldSearchUrl({
      destination: "Lisbon",
      startDate: "2026-08-01",
      endDate: "2026-08-05",
    });
    expect(url).toContain("awin1.com/cread.php");
    expect(url).toContain("awinmid=3018"); // Hostelworld's merchant id
    expect(url).toContain("awinaffid=1234567");
    // The destination URL is URL-encoded inside `ued`
    expect(url).toMatch(/ued=[^&]*Lisbon/);
  });

  it("also accepts the generic AWIN_AFFILIATE_ID env name", async () => {
    process.env.AWIN_AFFILIATE_ID = "9876543";
    const { getHostelworldSearchUrl } = await import("./hostelworld");
    const url = getHostelworldSearchUrl({
      destination: "Bangkok",
      startDate: "2026-09-01",
      endDate: "2026-09-10",
    });
    expect(url).toContain("awinaffid=9876543");
  });

  it("strips the country suffix from the destination", async () => {
    const { getHostelworldSearchUrl } = await import("./hostelworld");
    const url = getHostelworldSearchUrl({
      destination: "Tokyo, Japan",
      startDate: "2026-06-01",
      endDate: "2026-06-05",
    });
    // Search keyword should be "Tokyo" alone, not "Tokyo, Japan"
    expect(url).toContain("search-keyword=Tokyo");
    expect(url).not.toContain("Japan");
  });

  it("respects custom guest counts", async () => {
    const { getHostelworldSearchUrl } = await import("./hostelworld");
    const url = getHostelworldSearchUrl({
      destination: "Berlin",
      startDate: "2026-10-01",
      endDate: "2026-10-04",
      guests: 4,
    });
    expect(url).toContain("number-of-guests=4");
  });
});

describe("isHostelworldAffiliateActive", () => {
  const origEnv = process.env;

  beforeEach(() => {
    process.env = { ...origEnv };
    delete process.env.HOSTELWORLD_AWIN_AFFILIATE_ID;
    delete process.env.AWIN_AFFILIATE_ID;
    vi.resetModules();
  });

  afterEach(() => {
    process.env = origEnv;
  });

  it("returns false when no affiliate id is configured", async () => {
    const { isHostelworldAffiliateActive } = await import("./hostelworld");
    expect(isHostelworldAffiliateActive()).toBe(false);
  });

  it("returns true when HOSTELWORLD_AWIN_AFFILIATE_ID is set", async () => {
    process.env.HOSTELWORLD_AWIN_AFFILIATE_ID = "1234567";
    const { isHostelworldAffiliateActive } = await import("./hostelworld");
    expect(isHostelworldAffiliateActive()).toBe(true);
  });
});
