#!/usr/bin/env node
// Fails when a tracked text file contains an email address that is neither a
// placeholder domain nor listed in .github/personal-data-allowlist.txt. The
// repository is public; test data belongs on example.com or test.local.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const TEXT = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|json|md|mdx|sql|ya?ml|toml|txt|html|css|sh|example|py)$/i;
const SKIP = new Set(["package-lock.json"]);
// A real top-level domain has at least two letters; "a@b.c" and "tool@v1.2.3" don't.
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![A-Za-z])/g;

// Domains that can never identify a person: placeholders, our own product
// addresses, vendor documentation examples and security-test fixtures.
const PLACEHOLDER_DOMAINS = [
  "example.com", "example.org", "example.net", "ejemplo.com", "esempio.com", "exemplo.com", "email.com",
  "test.local", "x.com", "x.io", "b.com", "monkeytravel.app", "notmonkeytravel.app", "evil.com",
  "users.noreply.github.com", "anthropic.com", "sentry.io",
];

const allowlist = new Set(
  readFileSync(".github/personal-data-allowlist.txt", "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim().toLowerCase())
    .filter((l) => l && !l.startsWith("#"))
);

const isPlaceholder = (domain) => PLACEHOLDER_DOMAINS.some((d) => domain === d || domain.endsWith("." + d));

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter((f) => f && TEXT.test(f) && !SKIP.has(f.split("/").pop()));

const offenders = [];
for (const file of files) {
  let src;
  try {
    src = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (src.includes("\0")) continue;
  src.split(/\r?\n/).forEach((line, i) => {
    for (const match of line.matchAll(EMAIL)) {
      const address = match[0].toLowerCase();
      const domain = address.slice(address.indexOf("@") + 1);
      if (isPlaceholder(domain) || allowlist.has(address)) continue;
      offenders.push(`${file}:${i + 1}: ${address.slice(0, 2)}…@${domain}`);
    }
  });
}

if (offenders.length) {
  console.error("Personal data check failed. Use example.com or test.local for test data, or add a deliberate address to .github/personal-data-allowlist.txt:");
  for (const o of offenders) console.error("  " + o);
  process.exit(1);
}
console.log(`Personal data check passed (${files.length} files).`);
