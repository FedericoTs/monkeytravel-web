import { useTranslations } from "next-intl";
import { normalizePace } from "@/lib/trip/pace";

/**
 * Labels a trip's pace in the visitor's language with the labels the wizard's
 * pace buttons use. A missing or legacy value reads as the pace it is treated as.
 */
export function usePaceLabel(): (pace: unknown) => string {
  const t = useTranslations("trips.pace");
  return (pace) => t(`${normalizePace(pace)}.label`);
}
