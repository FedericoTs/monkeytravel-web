"use client";

import { useTranslations } from "next-intl";
import type { Activity } from "@/types";

/** Says whose pick a stop is, when the owner fitted it in for someone going. */
export default function PickedByNote({ activity }: { activity: Pick<Activity, "picked_by"> }) {
  const t = useTranslations("common.activity");
  const name = typeof activity.picked_by === "string" ? activity.picked_by.trim() : "";
  if (!name) return null;
  return <p className="mt-1 text-xs text-slate-600">{t("pickedBy", { name })}</p>;
}
