import { useTranslations } from "next-intl";

/**
 * Labels an activity's `type` in the visitor's language. The generator does
 * not stay inside the types the messages know (a live run produced "cafe"
 * before it had a label), so an unknown type falls back to the raw word.
 */
export function useActivityTypeLabel(): (type: string | undefined) => string {
  const t = useTranslations("trips.activityTypes");
  return (type) => (type && t.has(type) ? t(type) : type ?? "");
}
