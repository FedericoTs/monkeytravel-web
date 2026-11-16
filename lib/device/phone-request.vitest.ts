/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { isPhoneRequest } from "./phone-request";

const from = (values: Record<string, string>) => ({ get: (name: string) => values[name.toLowerCase()] ?? null });

const PIXEL = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const FIREFOX_PHONE = "Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0";
const ANDROID_TABLET = "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
const IPAD = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";

describe("a request from a phone", () => {
  it("is told by the mobile client hint, either way, whatever the user agent says", () => {
    expect(isPhoneRequest(from({ "sec-ch-ua-mobile": "?1", "user-agent": DESKTOP }))).toBe(true);
    expect(isPhoneRequest(from({ "sec-ch-ua-mobile": "?0", "user-agent": PIXEL }))).toBe(false);
  });

  it.each([PIXEL, IPHONE, FIREFOX_PHONE])("is told by the user agent where there is no hint: %s", (ua) => {
    expect(isPhoneRequest(from({ "user-agent": ua }))).toBe(true);
  });

  it.each([ANDROID_TABLET, IPAD, DESKTOP])("isn't a tablet or a computer: %s", (ua) => {
    expect(isPhoneRequest(from({ "user-agent": ua }))).toBe(false);
  });

  it("isn't a request that says nothing of itself", () => {
    expect(isPhoneRequest(from({}))).toBe(false);
  });
});
