"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/ui/Toast";
import type { ItinerarySaveStatus } from "@/hooks/useItinerarySync";

/**
 * A change that didn't save says so on every screen. The status pill with the
 * retry sits above the plan and is hidden on phones, so a failed save went
 * unseen while someone edited further down. When a save fails, a notice stays
 * on screen with a Retry, and goes once a save goes through.
 */
export function useSaveFailedNotice(saveStatus: ItinerarySaveStatus, retry: () => void) {
  const t = useTranslations("trips");
  const { addToast, removeToast } = useToast();
  const notice = useRef<string | null>(null);
  const retryRef = useRef(retry);
  useEffect(() => {
    retryRef.current = retry;
  });

  useEffect(() => {
    if (saveStatus === "error" && !notice.current) {
      notice.current = addToast(t("detail.saveFailedNotice"), "error", 0, {
        label: t("detail.retrySave"),
        onClick: () => retryRef.current(),
      });
    } else if (saveStatus !== "error" && notice.current) {
      removeToast(notice.current);
      notice.current = null;
    }
  }, [saveStatus, addToast, removeToast, t]);
}
