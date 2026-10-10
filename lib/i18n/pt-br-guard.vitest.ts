import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * messages/pt is Brazilian Portuguese, and these strings were European
 * ("Partilhou-a sem conta. Registe-se…", "A guardar…"). The first check keeps
 * them pt-BR; the second keeps words only Portugal uses out of the whole folder.
 */
const DIR = join(process.cwd(), "messages", "pt");

const REWRITTEN: Record<string, string[]> = {
  "common.json": [
    "startOver.customReasonPlaceholder",
    "today.expenses.youAreOwed",
    "today.nothingToday",
    "share.socialText.emailBodyCrew",
    "share.ownerClaim.body",
    "share.ownerClaim.cta",
    "share.framing.crewHint",
    "share.framing.plainHint",
    "share.crewPrompt.body",
    "ai.assistant.notAppliedBody",
    "ai.preview.suggestedChange",
    "ai.preview.previewBadge",
    "ai.preview.applying",
    "ai.preview.applyChange",
    "ai.preview.helperText",
    "authPrompt.title",
    "authPrompt.magicLink.codePrompt",
    "authPrompt.magicLink.codeVerifying",
    "authPrompt.magicLink.codeRateLimited",
    "authPrompt.magicLink.codeNetwork",
  ],
  "trips.json": [
    "assistant.keepPlanButton",
    "wizard.draftRecovery.expired",
    "wizard.step1.planningStat",
    "wizard.step1.oneTap.datesPencilled",
    "wizard.step1.hintFlexibleDefault",
    "wizard.result.mobileSaveNudge",
    "wizard.result.shareAnonCta",
    "wizard.result.shareAnonCreating",
    "wizard.result.shareAnonError",
    "wizard.result.shareAnonKeepPrompt",
    "wizard.result.shareAnonKeepCta",
    "wizard.pendingClaim.title",
    "wizard.pendingClaim.titleGeneric",
    "wizard.pendingClaim.body",
    "wizard.pendingClaim.keep",
  ],
  "auth.json": ["login.resendSending", "login.resendRateLimited", "signup.resendRateLimited"],
  "consent.json": ["banner.pill"],
  "tools.json": ["packingList.contextNoteLabel"],
  "blog.json": ["posts.where-to-go-in-august.description"],
  "backpacker.json": ["features.subtitle", "faq.items.comfort.answer"],
  "destinations.json": ["style.content.shopping.intro", "style.content.shopping.faq2a"],
};

// A whole word or phrase: not inside another word ("partilh" is in "compartilhar").
const words = (alternatives: string) => new RegExp(`(?<!\\p{L})(?:${alternatives})(?!\\p{L})`, "iu");

// Only European Portuguese uses these, so they may not appear anywhere in pt.
const PORTUGAL_ONLY = words(
  [
    "partilh\\p{L}*",
    "regist(?:ar|ado|ada|e|o|os)",
    "telemóve(?:l|is)",
    "ecrãs?",
    "utilizador(?:es|a|as)?",
    "equipas?",
    "contact(?:o|os|ar|e)",
    "facto",
    "connosco",
    "planead[oa]s?",
    "planeamento",
    "planear",
    "teu|tua|teus|tuas",
    "\\p{L}+-te",
    "continuar a \\p{L}+(?:ar|er|ir|á-l[oa]|ê-l[oa]|i-l[oa])",
  ].join("|")
);

// Also pt-PT in the rewritten strings, though Brazil uses some of the words in other senses.
const PORTUGAL_IN_CONTEXT = words(
  [
    "guard\\p{L}*",
    "ligação",
    "introduz\\p{L}*",
    "definições",
    "demasiad[oa]s",
    "pedidos",
    "percebi",
    "tocares|tens|podes|queres",
    "(?:está|estão|estou|estamos|estava|estar) a \\p{L}+(?:ar|er|ir)",
    "gosto ou não gosto",
    "gama média",
    "frescura",
    "saldos",
    "por agora",
  ].join("|")
);
const STARTS_PROGRESSIVE = /^A \p{L}+(?:ar|er|ir)(?!\p{L}).*(?:…|\.\.\.)$/u; // "A guardar..."

function load(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(DIR, file), "utf8"));
}

function valueAt(messages: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], messages);
}

function strings(node: unknown, path = ""): Array<[string, string]> {
  if (typeof node === "string") return [[path, node]];
  if (Array.isArray(node)) return node.flatMap((v, i) => strings(v, `${path}[${i}]`));
  if (node && typeof node === "object") {
    return Object.entries(node).flatMap(([k, v]) => strings(v, path ? `${path}.${k}` : k));
  }
  return [];
}

describe("pt strings that were European Portuguese", () => {
  it.each(Object.entries(REWRITTEN).flatMap(([file, paths]) => paths.map((path) => [file, path])))(
    "%s %s reads as pt-BR",
    (file, path) => {
      const value = valueAt(load(file), path);
      expect(typeof value).toBe("string");
      for (const pattern of [PORTUGAL_ONLY, PORTUGAL_IN_CONTEXT, STARTS_PROGRESSIVE]) {
        expect(value as string).not.toMatch(pattern);
      }
    }
  );
});

describe("messages/pt as a whole", () => {
  it("has no words only Portugal uses", () => {
    const hits = readdirSync(DIR)
      .filter((file) => file.endsWith(".json"))
      .flatMap((file) => strings(load(file)).map(([path, value]) => [`${file} ${path}`, value] as const))
      .filter(([, value]) => PORTUGAL_ONLY.test(value) || STARTS_PROGRESSIVE.test(value))
      .map(([where, value]) => `${where}: ${value}`);
    expect(hits).toEqual([]);
  });

  it("would catch the old strings (the guard is not vacuous)", () => {
    expect("Partilhou-a sem conta. Registe-se grátis").toMatch(PORTUGAL_ONLY);
    expect("Devem-te {amount}").toMatch(PORTUGAL_ONLY);
    expect("Nada planeado para hoje.").toMatch(PORTUGAL_ONLY);
    expect("Quer continuar a editá-lo?").toMatch(PORTUGAL_ONLY);
    expect("Nada muda até tocares em Guardar na minha viagem").toMatch(PORTUGAL_IN_CONTEXT);
    expect("A guardar...").toMatch(STARTS_PROGRESSIVE);
    expect("Compartilhar esta viagem").not.toMatch(PORTUGAL_ONLY);
    expect("A seguir").not.toMatch(STARTS_PROGRESSIVE);
  });
});
