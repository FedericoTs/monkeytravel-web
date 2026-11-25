/** @vitest-environment node */
import { describe, it, expect, afterEach, vi } from "vitest";
import { isProbeSession, writesTelemetry } from "./telemetry-env";

afterEach(() => vi.unstubAllEnvs());

describe("isProbeSession", () => {
  it("knows a tagged probe by the start of its session id, and nothing else", () => {
    expect(isProbeSession("e2eprobe-techdebt-live-stream-1")).toBe(true);
    expect(isProbeSession("3f1c0a9e-6d2b-4a51-9c3e-0b7f2d8e4a11")).toBe(false);
    expect(isProbeSession("live-e2eprobe-1")).toBe(false);
    expect(isProbeSession(null)).toBe(false);
    expect(isProbeSession(undefined)).toBe(false);
  });
});

describe("writesTelemetry", () => {
  it("writes every row in production, with or without a session", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    expect(writesTelemetry("3f1c0a9e-6d2b-4a51-9c3e-0b7f2d8e4a11")).toBe(true);
    expect(writesTelemetry("no_session")).toBe(true);
    expect(writesTelemetry(null)).toBe(true);
  });

  it("drops what a preview, local dev or the CI e2e build would send", () => {
    // The CI job builds with the production database's public URL and key,
    // but no session is ever minted there: every row was "no_session".
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(writesTelemetry("no_session")).toBe(false);
    vi.stubEnv("VERCEL_ENV", "");
    expect(writesTelemetry(undefined)).toBe(false);
    expect(writesTelemetry("3f1c0a9e-6d2b-4a51-9c3e-0b7f2d8e4a11")).toBe(false);
  });

  it("keeps a session explicitly tagged as a probe, so it can be deleted after", () => {
    vi.stubEnv("VERCEL_ENV", "");
    expect(writesTelemetry("e2eprobe-cls")).toBe(true);
  });
});
