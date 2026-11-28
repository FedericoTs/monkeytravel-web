// The h2 that opens a post's questions section, in each language posts are written in, and what follows it up to
// the next rule.
const FAQ_SECTION =
  /<h2[^>]*>[^<]*?(?:FAQ|Frequently Asked Questions|Common Questions|Preguntas frecuentes|Domande frequenti|Perguntas frequentes)[^<]*?<\/h2>([\s\S]*?)(?=<hr|$)/i;

// A question is an h3 with the paragraph after it, or a bold question that opens its own answer's paragraph.
const QUESTION =
  /<h3[^>]*>(.*?)<\/h3>\s*<p>([\s\S]*?)<\/p>|<p>\s*<strong>([^<]*\?)<\/strong>\s*(?:<br\s*\/?>)?([\s\S]*?)<\/p>/gi;

const text = (html: string) => html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();

/**
 * The questions and answers of a post's questions section, read from its rendered HTML.
 */
export function extractFAQs(html: string): { question: string; answer: string }[] {
  const faqs: { question: string; answer: string }[] = [];
  const section = html.match(FAQ_SECTION);
  if (!section) return faqs;

  for (const match of section[1].matchAll(QUESTION)) {
    const question = text(match[1] ?? match[3]);
    const answer = text(match[2] ?? match[4]);
    if (question && answer) faqs.push({ question, answer });
  }
  return faqs;
}
