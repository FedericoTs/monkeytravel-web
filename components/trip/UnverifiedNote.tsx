"use client";

import { useTranslations } from "next-intl";
import type { Activity } from "@/types";

/** Says a place to eat couldn't be found on Google Maps, so the traveller checks it before going. */
export default function UnverifiedNote({ activity }: { activity: Pick<Activity, "unverified"> }) {
  const t = useTranslations("common.activity");
  if (!activity.unverified) return null;
  return <p className="mt-1 text-xs text-amber-700">{t("unverified")}</p>;
}
