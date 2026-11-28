import { describe, it, expect } from "vitest";
import { getAllSlugs, getPostBySlug, hasLocaleTranslation } from "./api";
import { extractFAQs } from "./faq";

const section = (heading: string) =>
  `<p>Intro.</p><h2 id="x">${heading}</h2><h3>First <em>question</em>?</h3>\n<p>First <a href="/a">answer</a>.</p>` +
  `<h3>Second question?</h3><p>Second answer.</p><p>More of it.</p><hr><h3>After the rule?</h3><p>Not a question of the section.</p>`;

describe("a post's questions section", () => {
  it("reads each question with its first paragraph, tags removed, up to the rule", () => {
    expect(extractFAQs(section("Frequently Asked Questions"))).toEqual([
      { question: "First question?", answer: "First answer." },
      { question: "Second question?", answer: "Second answer." },
    ]);
  });

  it.each([
    ["en", "FAQ"],
    ["en", "Frequently asked questions"],
    ["en", "Frequently Asked Questions (FAQ)"],
    ["en", "Practical Tips & FAQ"],
    ["en", "Common Questions About Rome"],
    ["es", "Preguntas frecuentes"],
    ["es", "Preguntas Frecuentes"],
    ["es", "Consejos Prácticos y Preguntas Frecuentes"],
    ["it", "Domande frequenti"],
    ["it", "Domande Frequenti"],
    ["pt", "Perguntas frequentes"],
    ["pt", "Perguntas Frequentes"],
    ["pt", "Dicas Práticas e Perguntas Frequentes"],
  ])("%s: the heading \"%s\" opens it", (_locale, heading) => {
    expect(extractFAQs(section(heading))).toHaveLength(2);
  });

  it.each([
    "La pregunta que decide de verdad la duración",
    "La domanda che decide davvero la durata del viaggio",
    "A pergunta que realmente decide a duração da viagem",
    "The Question That Actually Decides Trip Length",
    "Paso 3: Presenta opciones, no preguntas abiertas",
  ])("a heading that only mentions a question is not it: \"%s\"", (heading) => {
    expect(extractFAQs(section(heading))).toEqual([]);
  });

  it("reads a bold question that opens its answer's paragraph, in the order written", () => {
    const html =
      `<h2>FAQ</h2>
<p><strong>Is Bari in Salento?</strong>
No. It is further <em>north</em>.</p>
` +
      `<h3>How far is it?</h3><p>About 150 km.</p>` +
      `<p><strong>¿Se puede ir en el día?</strong><br>En teoría sí.</p>`;
    expect(extractFAQs(html)).toEqual([
      { question: "Is Bari in Salento?", answer: "No. It is further north." },
      { question: "How far is it?", answer: "About 150 km." },
      { question: "¿Se puede ir en el día?", answer: "En teoría sí." },
    ]);
  });

  it("a bold lead that is not a question, or a question with no answer beside it, is not one", () => {
    const html =
      `<h2>FAQ</h2><p><strong>Note:</strong> prices change.</p><p><strong>Is it open?</strong></p><p>Mostly.</p>`;
    expect(extractFAQs(html)).toEqual([]);
  });

  it("a post without the section has none", () => {
    expect(extractFAQs("<h2>Getting there</h2><h3>By train?</h3><p>Yes.</p>")).toEqual([]);
  });
});

/**
 * Runs on the real content tree: a post whose markdown has a questions heading in its own language must hand
 * search engines those questions, in every language it is published in.
 */
describe("published posts with a questions heading", () => {
  const QUESTIONS_HEADING = /^## .*(?:FAQ|frequently asked questions|preguntas frecuentes|domande frequenti|perguntas frequentes)/im;
  for (const locale of ["en", "es", "it", "pt"] as const) {
    it(`${locale}: each one yields its questions`, async () => {
      const slugs = getAllSlugs().filter((s) => locale === "en" || hasLocaleTranslation(s, locale));
      const silent: string[] = [];
      let withHeading = 0;
      for (const slug of slugs) {
        const post = await getPostBySlug(slug, locale);
        if (!post || !QUESTIONS_HEADING.test(post.content)) continue;
        withHeading += 1;
        if (post.frontmatter.faq?.length) continue;
        if (extractFAQs(post.html).length === 0) silent.push(slug);
      }
      expect(withHeading).toBeGreaterThan(50);
      expect(silent).toEqual([]);
    }, 120_000);
  }
});
