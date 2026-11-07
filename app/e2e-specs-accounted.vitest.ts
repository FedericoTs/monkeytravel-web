// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The browser workflows run a fixed list of specs, so a spec left off the list
 * never runs and nothing says so. Each spec is either on a list or here, with the
 * reason it can't run there.
 */
const NOT_IN_CI: Record<string, string> = {
  "account-deletion.spec.ts": "permanently deletes the account it runs as",
  "anonymous-generation.spec.ts": "makes real plans, which spends on the model",
  "anonymous-voting.spec.ts": "needs a real share link",
  "assistant-honesty.spec.ts": "asks the real assistant, which spends on the model",
  "autosave-unresolved-flag.spec.ts": "makes a real plan, which spends on the model",
  "collab-bug-fixes.spec.ts": "reads production",
  "email-invites.spec.ts": "reads production",
  "invite-acceptance-rls.spec.ts": "needs a real invite token",
  "notification-preferences.spec.ts": "reads production",
  "save-auth-wall.spec.ts": "makes a real plan, which spends on the model",
  "share-prompt.spec.ts": "needs an account with a trip not yet shared",
  "streaming-generation.spec.ts": "makes a real plan, which spends on the model",
  "tools-visa-checker.spec.ts": "reads production",
  "trips-share-token-lockdown.spec.ts": "reads production's policies",
  "users-rls-lockdown.spec.ts": "reads production's policies with two accounts",
  "wizard-mobile.spec.ts": "makes a real plan, which spends on the model",
};

const root = process.cwd();
const specs = readdirSync(join(root, "tests", "e2e")).filter((name) => name.endsWith(".spec.ts"));
const workflows = ["e2e-public.yml", "e2e-signed-in.yml"].map((name) => readFileSync(join(root, ".github", "workflows", name), "utf8"));
const inCi = new Set(workflows.flatMap((text) => [...text.matchAll(/tests\/e2e\/([\w.-]+\.spec\.ts)/g)].map((m) => m[1])));

describe("the browser specs", () => {
  it("each runs in CI, or says why it can't", () => {
    expect(specs.filter((name) => !inCi.has(name) && !NOT_IN_CI[name])).toEqual([]);
  });

  it("a spec in CI isn't also listed as not in CI", () => {
    expect(Object.keys(NOT_IN_CI).filter((name) => inCi.has(name))).toEqual([]);
  });

  it("names only specs that exist", () => {
    expect([...inCi, ...Object.keys(NOT_IN_CI)].filter((name) => !specs.includes(name))).toEqual([]);
  });
});
