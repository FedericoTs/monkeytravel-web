/**
 * "Where should I go?": the questions, and the code that carries the answers.
 *
 * Nothing is stored. The answers travel in the link as six digits and a letter
 * for the person's continent, so anyone can open a result and it renders from
 * the link alone. The words live in messages/<locale>/match.json.
 *
 * Safe for the browser: the destinations themselves stay on the server.
 */
export const QUESTIONS = [
  { id: "morning", options: ["sea", "streets", "food", "trail"] },
  { id: "evening", options: ["dinner", "dance", "rooftop", "early"] },
  { id: "when", options: ["spring", "summer", "autumn", "winter", "open"] },
  { id: "budget", options: ["tight", "comfortable", "treat"] },
  { id: "who", options: ["solo", "couple", "friends", "family"] },
  { id: "far", options: ["near", "far", "anywhere"] },
] as const;

export type QuestionId = (typeof QUESTIONS)[number]["id"];

/**
 * Where the person is, by continent, the Americas split in two: `m` is North
 * America (Central America and the Caribbean with it), `s` South America. `x`
 * when it isn't known.
 */
export type Home = "e" | "a" | "m" | "s" | "f" | "o" | "x";

export interface Person {
  /** The chosen option of each question, in question order. */
  answers: readonly number[];
  home: Home;
}

const HOME_BY_CONTINENT: Record<string, Home> = { EU: "e", AS: "a", NA: "m", SA: "s", AF: "f", OC: "o" };

/** The letter for a continent code as Vercel's geo header gives it. */
export function homeFromContinent(continent: string | null | undefined): Home {
  return (continent && HOME_BY_CONTINENT[continent.toUpperCase()]) || "x";
}

const CODE_RE = /^[0-9]{6}[eamsfox]$/;

export function makeCode(answers: readonly number[], home: Home): string {
  return `${answers.join("")}${home}`;
}

/** The person a code stands for, or null for anything a real answer can't produce. */
export function parseCode(code: string | null | undefined): Person | null {
  if (!code || !CODE_RE.test(code)) return null;
  const answers = [...code.slice(0, 6)].map(Number);
  if (answers.some((answer, i) => answer >= QUESTIONS[i].options.length)) return null;
  return { answers, home: code[6] as Home };
}

/** Most friends a shared result carries. */
export const MAX_COMPANIONS = 3;

/** The valid, distinct codes in a `with` parameter, leaving out `own`. */
export function parseCompanions(raw: string | string[] | null | undefined, own?: string): string[] {
  // A query parameter repeated in the link arrives as a list.
  const text = Array.isArray(raw) ? raw.join(",") : (raw ?? "");
  const codes = text.split(",").filter((code) => code !== own && parseCode(code) !== null);
  return [...new Set(codes)].slice(0, MAX_COMPANIONS);
}
