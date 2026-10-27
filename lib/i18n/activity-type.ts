import { useTranslations } from "next-intl";
import { activityTypeKey } from "@/lib/trip/activity-type";

export { ACTIVITY_TYPE_KEYS, activityTypeKey, type ActivityTypeKey } from "@/lib/trip/activity-type";

/**
 * Labels an activity's `type` in the visitor's language. A type with no
 * recognisable category reads as a plain "Activity", never as the raw word.
 */
export function useActivityTypeLabel(): (type: string | undefined) => string {
  const t = useTranslations("trips.activityTypes");
  return (type) => (type ? t(activityTypeKey(type) ?? "activity") : "");
}
