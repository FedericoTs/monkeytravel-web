"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/ui/Toast";
import type { SessionTripSnapshot } from "@/hooks/useSessionTripStack";
import { sentryException } from "@/lib/observability/sentry";
import { capture } from "@/lib/posthog/events";
import { createClient } from "@/lib/supabase/client";
import { readPendingClaim } from "@/lib/trips/anonymous-claim-client";
import { findRecentTwin } from "@/lib/trips/recent-twin";
import { newWizardMountId, wizardTripWrites } from "@/lib/trips/wizard-trip-writes";
import { forgetVisitToKeep, keepVisitTrips, visitToKeep } from "@/lib/wizard/visit-trips";

/**
 * After a sign-in from the save box, the visit's other places are saved too (lib/wizard/visit-trips.ts), once the
 * plan on screen is, and the planner is told which. Once per mount; the mark is forgotten after the run, and a run
 * that a reload cut short saves only what the account doesn't hold yet.
 */
export function useKeepVisitTrips({
  trips,
  userId,
  currentSaved,
  locale,
}: {
  trips: SessionTripSnapshot[];
  userId: string | null;
  /** The plan on screen is saved (or adopted): the others follow it. */
  currentSaved: boolean;
  locale: string;
}): void {
  const t = useTranslations("trips.save");
  const { addToast } = useToast();
  const [writes] = useState(() => wizardTripWrites(newWizardMountId()));
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current || !userId || !currentSaved || trips.length === 0) return;
    const ids = visitToKeep();
    if (ids.length === 0) return;
    ran.current = true;
    void (async () => {
      const claimed = await readPendingClaim().catch(() => null);
      const supabase = createClient();
      const kept = await keepVisitTrips(ids, trips, {
        userId,
        locale,
        claimed,
        isTwin: async (uid, trip) => (await findRecentTwin(supabase, uid, trip)) !== null,
        save: writes.saveTrip,
        attachCover: writes.attachCoverImage,
        onError: (err) => sentryException(err, { tags: { feature: "keep_visit_trips" } }),
      });
      forgetVisitToKeep();
      void capture("visit_trips_kept", { marked: ids.length, kept: kept.length });
      if (kept.length > 0) {
        const places = kept.map((trip) => trip.destination.split(",")[0].trim()).join(", ");
        addToast(t("keptToo", { places }), "success", 6000);
      }
    })();
  }, [userId, currentSaved, trips, locale, writes, addToast, t]);
}
