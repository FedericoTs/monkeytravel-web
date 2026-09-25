import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { maskEmail, sameEmail } from "./recipient";

describe("maskEmail", () => {
  it("keeps enough to recognise your own inbox", () => {
    expect(maskEmail("federico@gmail.com")).toBe("f•••o@gmail.com");
    expect(maskEmail("  Ana.Lopez@Example.org ")).toBe("A•••z@Example.org");
  });

  it("never gives away a short local part", () => {
    expect(maskEmail("ab@x.io")).toBe("a•••@x.io");
    expect(maskEmail("a@x.io")).toBe("a•••@x.io");
  });

  it("does not echo something that is not an address", () => {
    expect(maskEmail("nope")).toBe("•••");
    expect(maskEmail("@x.io")).toBe("•••");
  });
});

describe("sameEmail", () => {
  it("compares the way the accept route does", () => {
    expect(sameEmail("A@x.io ", "a@X.io")).toBe(true);
    expect(sameEmail("a@x.io", "b@x.io")).toBe(false);
    expect(sameEmail("", "")).toBe(false);
    expect(sameEmail(null, null)).toBe(false);
  });
});

describe("the invite page for an emailed invite", () => {
  const page = readFileSync(join(process.cwd(), "app/[locale]/invite/[token]/page.tsx"), "utf8");

  it("renders the sign-in gate, not a dead-end error, when the visitor is not the invitee", () => {
    // 2026-09-24: this was an error screen whose only button was "Create Your
    // Own Trip". 0 of 5 emailed invites to people without an account were
    // accepted.
    expect(page).toMatch(/data\.error === "RECIPIENT_MISMATCH"\) \{\s*return \(\s*<InviteRecipientGate/);
    expect(page).toContain("maskedRecipient: maskEmail(String(invite.recipient_email))");
  });

  it("never hands the full invited address to the page", () => {
    const gate = page.slice(page.indexOf("<InviteRecipientGate"), page.indexOf("/>", page.indexOf("<InviteRecipientGate")));
    expect(gate).not.toMatch(/recipient_email/);
  });
});
