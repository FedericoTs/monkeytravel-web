import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { adminEmails, getAdminName, isAdmin } from "./admin";

afterEach(() => vi.unstubAllEnvs());

describe("the admins", () => {
  it("come from ADMIN_EMAILS, plain or named, any case, spaces trimmed", () => {
    vi.stubEnv("ADMIN_EMAILS", " Ada <Ada@Example.com>, ops@example.org ,,");
    expect(adminEmails()).toEqual(["ada@example.com", "ops@example.org"]);
    expect(isAdmin("ADA@example.com")).toBe(true);
    expect(isAdmin("ops@example.org")).toBe(true);
    expect(isAdmin("someone@example.com")).toBe(false);
    expect(isAdmin(null)).toBe(false);
  });

  it("are no one when ADMIN_EMAILS is unset", () => {
    vi.stubEnv("ADMIN_EMAILS", "");
    expect(adminEmails()).toEqual([]);
    expect(isAdmin("ada@example.com")).toBe(false);
  });

  it("are greeted by their configured name, else their email's local part", () => {
    vi.stubEnv("ADMIN_EMAILS", "Ada <ada@example.com>, ops@example.org");
    expect(getAdminName("ada@example.com")).toBe("Ada");
    expect(getAdminName("ops@example.org")).toBe("ops");
  });
});

// The admin list is server-only: a client component that imports it ships
// the addresses in every page's JavaScript.
describe("lib/admin", () => {
  it("is imported by no client component", () => {
    const files = execSync("git ls-files --cached --others --exclude-standard app components lib hooks", { encoding: "utf8" })
      .split("\n")
      .filter((f) => /\.tsx?$/.test(f) && !f.includes(".vitest."));
    const client = files.filter((f) => {
      const src = readFileSync(f, "utf8");
      return /^\s*["']use client["']/.test(src) && /from ["']@\/lib\/admin["']/.test(src);
    });
    expect(client).toEqual([]);
  });

  it("holds no address itself", () => {
    expect(readFileSync("lib/admin.ts", "utf8")).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
  });
});
