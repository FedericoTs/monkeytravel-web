import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Spanish, Italian and Portuguese copy is spelled with its accents. Whole files
 * were written without them ("Contrasena", "Nao tem uma conta?", "Hai gia un
 * account?"). Each list holds spellings that are wrong in every context, so a
 * hit is always a missing accent: words that are also correct unaccented
 * ("esta", "mas", "e") are left out.
 */
const words = (alternatives: string[]) =>
  // Not inside a longer word, and not the local part of an address (voce@exemplo.com).
  new RegExp(`(?<!\\p{L})(?:${alternatives.join("|")})(?![\\p{L}@])`, "giu");

const UNACCENTED: Record<string, RegExp> = {
  es: words([
    "\\p{L}+cion", // -ción
    "\\p{L}+sion", // -sión
    "contrasenas?",
    "dias?",
    "pais",
    "tambien",
    "codigos?",
    "paginas?",
    "aqui",
    "facil",
    "despues",
    "todavia",
    "intentalo",
    "registrate",
    "unete",
    "ayudanos",
    "cuentanos",
    "minusculas?",
    "mayusculas?",
  ]),
  it: words(["gia", "piu", "puo", "perche", "poiche", "citta", "attivita", "funzionalita", "accessibilita", "qualita", "novita", "caffe"]),
  pt: words(["voces?", "nao", "tambem", "possivel", "enderecos?", "estao", "\\p{L}+cao", "\\p{L}+coes"]),
};

function strings(node: unknown, path = ""): Array<[string, string]> {
  if (typeof node === "string") return [[path, node]];
  if (Array.isArray(node)) return node.flatMap((v, i) => strings(v, `${path}[${i}]`));
  if (node && typeof node === "object") {
    return Object.entries(node).flatMap(([k, v]) => strings(v, path ? `${path}.${k}` : k));
  }
  return [];
}

describe.each(Object.entries(UNACCENTED))("messages/%s", (locale, pattern) => {
  it("has no word spelled without its accent", () => {
    const dir = join(process.cwd(), "messages", locale);
    const hits = readdirSync(dir)
      .filter((file) => file.endsWith(".json"))
      .flatMap((file) =>
        strings(JSON.parse(readFileSync(join(dir, file), "utf8"))).flatMap(([path, value]) =>
          [...value.matchAll(pattern)].map((match) => `${file} ${path}: ${match[0]}`)
        )
      );
    expect(hits).toEqual([]);
  });
});
