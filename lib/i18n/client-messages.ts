import type { AbstractIntlMessages } from "next-intl";

/**
 * The namespaces client components on the marketing (prerendered) pages read.
 * Server components use getTranslations and see the whole catalog either way;
 * this only decides what is serialized into each page for hydration. The
 * (app) route group provides the full catalog.
 */
export const MARKETING_CLIENT_NAMESPACES = ["common", "consent", "blog", "tools", "contact"] as const;

export function pickMessages(messages: AbstractIntlMessages, namespaces: readonly string[]): AbstractIntlMessages {
  return Object.fromEntries(namespaces.filter((ns) => ns in messages).map((ns) => [ns, messages[ns]]));
}
