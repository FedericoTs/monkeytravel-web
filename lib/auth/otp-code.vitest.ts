import { describe, it, expect } from "vitest";
import {
  OTP_CODE_LENGTH,
  OTP_VERIFY_TYPES,
  normalizeOtpCode,
  isCompleteOtpCode,
  classifyOtpError,
  shouldTryNextType,
  otpErrorMessageKey,
} from "./otp-code";

describe("normalizeOtpCode", () => {
  it("accepts the digits as typed", () => {
    expect(normalizeOtpCode("123456")).toBe("123456");
  });

  it("accepts every shape people actually paste out of the email", () => {
    // Rejecting a paste that plainly contains the right code sends someone
    // back to the mail app — the exact trip this feature removes.
    expect(normalizeOtpCode("123 456")).toBe("123456");
    expect(normalizeOtpCode("123-456")).toBe("123456");
    expect(normalizeOtpCode("Or enter this code: 123456")).toBe("123456");
    expect(normalizeOtpCode("  123456  ")).toBe("123456");
  });

  it("stops at six digits", () => {
    expect(normalizeOtpCode("1234567890")).toBe("123456");
    expect(normalizeOtpCode("123456").length).toBe(OTP_CODE_LENGTH);
  });

  it("survives nothing at all", () => {
    expect(normalizeOtpCode("")).toBe("");
    expect(normalizeOtpCode("abc")).toBe("");
    // The field is user input; undefined must not throw mid-keystroke.
    expect(normalizeOtpCode(undefined as unknown as string)).toBe("");
  });
});

describe("isCompleteOtpCode", () => {
  it("is true only at exactly six digits", () => {
    expect(isCompleteOtpCode("123456")).toBe(true);
    expect(isCompleteOtpCode("12345")).toBe(false);
    expect(isCompleteOtpCode("1234567")).toBe(false);
    expect(isCompleteOtpCode("")).toBe(false);
    expect(isCompleteOtpCode("12345a")).toBe(false);
  });
});

describe("classifyOtpError", () => {
  it("tells an expired code from a wrong one", () => {
    // Different sentences: one means ask for a new code, the other means
    // check the digits.
    expect(classifyOtpError("Token has expired or is invalid")).toBe("expired");
    expect(classifyOtpError("Invalid token")).toBe("invalid");
  });

  it("never dresses a rate limit up as a wrong code", () => {
    // Otherwise the user retypes a code that was right the whole time.
    // GoTrue's real throttle string, which carries none of the obvious tokens.
    expect(classifyOtpError("For security purposes, you can only request this after 60 seconds")).toBe("rate_limit");
    expect(classifyOtpError("Email rate limit exceeded")).toBe("rate_limit");
    expect(classifyOtpError("Too many requests")).toBe("rate_limit");
    expect(classifyOtpError("Request failed with status 429")).toBe("rate_limit");
  });

  it("recognises a dead connection", () => {
    expect(classifyOtpError("Failed to fetch")).toBe("network");
    expect(classifyOtpError("network error")).toBe("network");
  });

  it("falls back rather than guessing", () => {
    expect(classifyOtpError("")).toBe("unknown");
    expect(classifyOtpError(undefined)).toBe("unknown");
    expect(classifyOtpError(null)).toBe("unknown");
    expect(classifyOtpError("something we have never seen")).toBe("unknown");
  });

  it("prefers expired over invalid when the message says both", () => {
    // Supabase's real string is "Token has expired or is invalid" — reading
    // that as "invalid" would tell the user to re-check correct digits.
    expect(classifyOtpError("Token has expired or is invalid")).toBe("expired");
  });
});

describe("shouldTryNextType", () => {
  it("retries only a wrong-type-looking failure", () => {
    // A correct code submitted under the wrong type reads as "invalid".
    expect(shouldTryNextType("invalid")).toBe(true);
  });

  it("does not burn attempts on failures every type shares", () => {
    expect(shouldTryNextType("expired")).toBe(false);
    expect(shouldTryNextType("rate_limit")).toBe(false);
    expect(shouldTryNextType("network")).toBe(false);
    expect(shouldTryNextType("unknown")).toBe(false);
  });
});

describe("OTP_VERIFY_TYPES", () => {
  it("tries the documented signInWithOtp type first", () => {
    // The common path should cost one request, not three.
    expect(OTP_VERIFY_TYPES[0]).toBe("email");
  });

  it("covers both emails signInWithOtp can send", () => {
    // shouldCreateUser: true sends `signup` to a new address and `magiclink`
    // to an existing one, and the client cannot know which.
    expect(OTP_VERIFY_TYPES).toContain("signup");
    expect(OTP_VERIFY_TYPES).toContain("magiclink");
  });
});

describe("otpErrorMessageKey", () => {
  it("gives every bucket its own string", () => {
    const kinds = ["invalid", "expired", "rate_limit", "network", "unknown"] as const;
    const keys = kinds.map(otpErrorMessageKey);
    expect(new Set(keys).size).toBe(kinds.length);
    for (const k of keys) expect(k.startsWith("magicLink.")).toBe(true);
  });
});
