"use client";

import { useCallback, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useToast } from "@/components/ui/Toast";
import { useChanged } from "@/hooks/useChanged";
import { trackReferralLinkClicked, trackTripShared } from "@/lib/analytics";
import { openExternal } from "@/lib/native/external-link";
import { shareFile } from "@/lib/native/share";
import { captureTripCardShared } from "@/lib/posthog/events";
import { tripCardPath } from "@/lib/seo/og-image";
import { defaultShareFraming, framedShareUrl, shareTokenFromUrl, type ShareFraming } from "@/lib/trips/crew-share";
import type { ChosenTripIntent } from "@/lib/wizard/answers";

/**
 * The share window's link tab: which link the owner hands out, copying and sending
 * it, the trip as a picture, the Explore listing and stopping the link. The window
 * holds this, not the tab, so moving to the other tab keeps the framing chosen.
 */
export function useShareLink({
  tripId,
  tripTitle,
  shareUrl,
  tripIntent,
  isInTrending,
  onTrendingChange,
  onRequestPublish,
}: {
  tripId: string;
  tripTitle: string;
  shareUrl: string;
  tripIntent?: ChosenTripIntent | null;
  isInTrending: boolean;
  onTrendingChange?: (isTrending: boolean) => void;
  onRequestPublish?: () => void;
}) {
  const t = useTranslations("common");
  const locale = useLocale();
  const ts = (key: string, params?: Record<string, string | number>) => t(`share.${key}`, params);
  const { addToast } = useToast();

  const [copied, setCopied] = useState(false);
  const [imageBusy, setImageBusy] = useState<"story" | "square" | null>(null);
  // Share framing: which link the owner hands out. Defaults from
  // the trip's intent (lib/trips/crew-share.ts); the owner can flip it.
  // Re-derived when the modal is reused for another trip.
  const [framing, setFraming] = useState<ShareFraming>(() => defaultShareFraming(tripIntent));
  const tripChanged = useChanged(tripId);
  const intentChanged = useChanged(tripIntent);
  if (tripChanged || intentChanged) setFraming(defaultShareFraming(tripIntent));
  const framedUrl = framedShareUrl(shareUrl, framing) ?? shareUrl;
  const crew = framing === "crew";
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const [trendingEnabled, setTrendingEnabled] = useState(isInTrending);
  const [trendingLoading, setTrendingLoading] = useState(false);

  // The window opened: nothing left over from last time, and the listing afresh.
  const reopen = useCallback((listed: boolean) => {
    setCopied(false);
    setShowStopConfirm(false);
    setTrendingEnabled(listed);
  }, []);

  // Handle trending toggle
  const handleTrendingToggle = async () => {
    if (trendingLoading) return;
    // Listing goes through the publish flow, so its checks apply here too.
    if (!trendingEnabled) {
      onRequestPublish?.();
      return;
    }

    setTrendingLoading(true);
    try {
      const response = await fetch(`/api/trips/${tripId}/publish`, { method: "DELETE" });

      if (response.ok) {
        setTrendingEnabled(false);
        onTrendingChange?.(false);
      } else {
        addToast(ts("explore.unlistFailed"), "error");
      }
    } catch (error) {
      console.error("Failed to update trending status:", error);
      addToast(ts("explore.unlistFailed"), "error");
    } finally {
      setTrendingLoading(false);
    }
  };

  // Copy share URL
  const handleCopyShareUrl = async () => {
    try {
      await navigator.clipboard.writeText(framedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      addToast(ts("toast.viewOnlyCopied"), "success");
      trackTripShared({ tripId, shareMethod: "link" });
      trackReferralLinkClicked({ code: tripId, medium: "copy" });
    } catch (error) {
      console.error("Failed to copy:", error);
      addToast(ts("toast.copyFailed"), "error");
    }
  };

  // Social sharing. openExternal() opens @capacitor/browser in the app (the
  // iOS web view swallows window.open "_blank") and window.open on the web.
  const handleShareTwitter = () => {
    const text = encodeURIComponent(ts(crew ? "socialText.twitterCrew" : "socialText.twitterShare", { tripTitle }));
    const url = encodeURIComponent(framedUrl);
    void openExternal(`https://twitter.com/intent/tweet?text=${text}&url=${url}`);
    trackTripShared({ tripId, shareMethod: "social" });
  };

  const handleShareWhatsApp = () => {
    const text = encodeURIComponent(`${ts(crew ? "socialText.whatsappCrew" : "socialText.whatsappShare", { tripTitle })}\n${framedUrl}`);
    void openExternal(`https://wa.me/?text=${text}`);
    trackTripShared({ tripId, shareMethod: "social" });
  };

  const handleShareEmail = () => {
    const subject = encodeURIComponent(ts(crew ? "socialText.emailSubjectCrew" : "socialText.emailSubject", { tripTitle }));
    const body = encodeURIComponent(`${ts(crew ? "socialText.emailBodyCrew" : "socialText.emailBody")}\n\n${framedUrl}`);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
    trackTripShared({ tripId, shareMethod: "email" });
  };

  // The trip as a picture (app/api/og/trip): the OS share sheet when the
  // browser will take a file, otherwise a download.
  const shareToken = shareTokenFromUrl(shareUrl);
  const handleShareImage = async (format: "story" | "square") => {
    if (!shareToken || imageBusy) return;
    setImageBusy(format);
    try {
      const res = await fetch(tripCardPath({ token: shareToken }, { format, locale }));
      if (!res.ok) throw new Error(`card ${res.status}`);
      const blob = await res.blob();
      const stem = tripTitle.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").toLowerCase() || "trip";
      const outcome = await shareFile(new File([blob], `${stem}-${format}.png`, { type: "image/png" }), { title: tripTitle });
      if (outcome === "cancelled") return;
      const method = outcome === "shared" ? "native_share" : "download";
      trackTripShared({ tripId, shareMethod: "image" });
      void captureTripCardShared({ trip_id: tripId, format, method });
      // The first-party count: the PostHog event fires only with analytics consent.
      void fetch("/api/funnel-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_type: "trip_card_shared", trip_id: tripId, format, method }),
        keepalive: true,
      }).catch(() => {});
    } catch (error) {
      console.error("Failed to share the trip image:", error);
      addToast(ts("image.failed"), "error");
    } finally {
      setImageBusy(null);
    }
  };

  return {
    framing,
    setFraming,
    framedUrl,
    crew,
    copied,
    imageBusy,
    shareToken,
    showStopConfirm,
    setShowStopConfirm,
    trendingEnabled,
    trendingLoading,
    reopen,
    handleTrendingToggle,
    handleCopyShareUrl,
    handleShareTwitter,
    handleShareWhatsApp,
    handleShareEmail,
    handleShareImage,
  };
}
