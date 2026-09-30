import type { AbstractIntlMessages } from "next-intl";

/**
 * The message subtrees client components read, as dotted paths, one list per
 * provider. Server components use getTranslations and see the whole catalog
 * either way; these lists only decide what is serialized into each page for
 * hydration. lib/i18n/client-messages.vitest.ts checks the lists against the code.
 */
export const MARKETING_CLIENT_NAMESPACES = [
  "common.buttons",
  "common.navigation",
  "common.bottomNav",
  "common.language",
  "common.maintenance",
  "common.share.notifications",
  "common.referral",
  "common.emailSubscribe",
  "common.pageShare",
  "common.curatedEscapes",
  "consent",
  "contact",
] as const;

export const BLOG_CLIENT_NAMESPACES = [...MARKETING_CLIENT_NAMESPACES, "blog"] as const;

export const TOOLS_CLIENT_NAMESPACES = [...MARKETING_CLIENT_NAMESPACES, "tools", "trips.wizard.datePicker"] as const;

/** The (app) route group: the namespaces its client code reads, without the marketing, blog and planner copy. */
export const APP_CLIENT_NAMESPACES = [
  "common",
  "trips",
  "auth",
  "profile",
  "bananas",
  "consent",
  "destinations.tags",
  "blog.tips",
  "blog.index",
] as const;

export const CHATGPT_IMPORT_CLIENT_NAMESPACES = [
  ...MARKETING_CLIENT_NAMESPACES,
  "trips.chatgptImport",
  "trips.activityTypes",
] as const;

const isTree = (value: unknown): value is AbstractIntlMessages => typeof value === "object" && value !== null;

/** The subtrees at `paths`, nested as in `messages`. A path below another listed path adds nothing. */
export function pickMessages(messages: AbstractIntlMessages, paths: readonly string[]): AbstractIntlMessages {
  const out: AbstractIntlMessages = {};
  const roots = paths.filter((path) => !paths.some((other) => other !== path && path.startsWith(`${other}.`)));
  for (const path of roots) {
    const keys = path.split(".");
    let source: unknown = messages;
    for (const key of keys) source = isTree(source) ? source[key] : undefined;
    if (source === undefined) continue;
    let target = out;
    for (const key of keys.slice(0, -1)) {
      const next = target[key];
      target = isTree(next) ? next : (target[key] = {});
    }
    target[keys[keys.length - 1]] = source as AbstractIntlMessages[string];
  }
  return out;
}
