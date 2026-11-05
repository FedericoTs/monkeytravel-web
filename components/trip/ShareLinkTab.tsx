"use client";

import { Check, Copy, Eye, Globe, Mail, Share2, TrendingUp } from "lucide-react";
import { useTranslations } from "next-intl";
import type { useShareLink } from "@/hooks/useShareLink";
import { cn } from "@/lib/utils";

/** The share window's link tab; its state is the window's (hooks/useShareLink.ts). */
export default function ShareLinkTab({
  link,
  isShared,
  canManageSharing,
  exploreEnabled,
  isLoading,
  onEnableSharing,
  onStopSharing,
}: {
  link: ReturnType<typeof useShareLink>;
  isShared: boolean;
  canManageSharing: boolean;
  exploreEnabled: boolean;
  isLoading: boolean;
  onEnableSharing: () => Promise<void>;
  onStopSharing: () => void;
}) {
  const t = useTranslations("common");
  const ts = (key: string) => t(`share.${key}`);
  const tb = (key: string) => t(`buttons.${key}`);
  const {
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
    handleTrendingToggle,
    handleCopyShareUrl,
    handleShareTwitter,
    handleShareWhatsApp,
    handleShareEmail,
    handleShareImage,
  } = link;

  return (
    <div className="space-y-6">
      {/* Context hint */}
      <div className="flex items-center gap-2 px-3 py-2 bg-slate-100 rounded-lg">
        <Eye className="w-4 h-4 text-slate-500 flex-shrink-0" />
        <p className="text-xs text-slate-600">
          <span className="font-medium">{ts("invite.viewOnlyLabel")}:</span> {ts("invite.viewOnlyHint")}
        </p>
      </div>

      {/* Not shared and not ours to share: say who can. */}
      {!isShared && !canManageSharing && <p className="text-sm text-slate-600 text-center py-4">{ts("invite.ownerOnly")}</p>}

      {/* Enable sharing if not shared */}
      {!isShared && canManageSharing && (
        <div className="text-center py-4">
          <p className="text-sm text-slate-600 mb-4">{ts("invite.enableSharing")}</p>
          <button
            onClick={onEnableSharing}
            disabled={isLoading}
            className="px-6 py-2.5 bg-[var(--primary)] text-white rounded-lg font-medium hover:bg-[var(--primary)]/90 transition-colors disabled:opacity-50"
          >
            {isLoading ? ts("invite.enabling") : ts("invite.enableSharingButton")}
          </button>
        </div>
      )}

      {/* Share URL */}
      {isShared && (
        <>
          <div>
            {/* The crew ask opens the recipient page on the vote, the plain link
                on the itinerary. Group-intent trips default to the ask
                (lib/trips/crew-share.ts, defaultShareFraming). */}
            <div role="radiogroup" aria-label={ts("framing.label")} className="mb-3 grid grid-cols-2 gap-2">
              {(["crew", "plain"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={framing === option}
                  data-testid={`share-framing-${option}`}
                  onClick={() => setFraming(option)}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-left text-sm font-medium transition-colors",
                    framing === option
                      ? "border-[var(--primary)] bg-[var(--primary)]/5 text-slate-900"
                      : "border-slate-200 text-slate-600 hover:bg-slate-50"
                  )}
                >
                  {ts(`framing.${option}`)}
                </button>
              ))}
            </div>
            <label className="block text-sm font-medium text-slate-700 mb-2">{ts("invite.publicLink")}</label>
            <div className="flex items-center gap-2">
              <input
                aria-label={ts("invite.publicLink")}
                type="text"
                value={framedUrl}
                readOnly
                className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 text-slate-600 truncate"
              />
              <button
                onClick={handleCopyShareUrl}
                className={cn(
                  "flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                  copied ? "bg-green-100 text-green-700" : "bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90"
                )}
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copied ? tb("copied") : tb("copy")}
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-500">{crew ? ts("framing.crewHint") : ts("framing.plainHint")}</p>
          </div>

          {/* Social Share */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">{ts("shareVia")}</label>
            {/* WhatsApp first: it's where trip crews live, in the it/es/pt markets
                especially. Twitter and email follow. */}
            <div className="flex items-center gap-3">
              <button
                onClick={handleShareWhatsApp}
                aria-label={ts("a11y.whatsapp")}
                title={ts("a11y.whatsapp")}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                </svg>
              </button>
              <button
                onClick={handleShareTwitter}
                aria-label={ts("a11y.twitter")}
                title={ts("a11y.twitter")}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
              </button>
              <button
                onClick={handleShareEmail}
                aria-label={ts("a11y.email")}
                title={ts("a11y.email")}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors"
              >
                <Mail className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* The trip as a picture, for stories, chats and feeds. */}
          {shareToken && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">{ts("image.label")}</label>
              <div className="flex items-center gap-3">
                {(["story", "square"] as const).map((format) => (
                  <button
                    key={format}
                    type="button"
                    onClick={() => handleShareImage(format)}
                    disabled={imageBusy !== null}
                    data-testid={`share-image-${format}`}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    <Share2 className="w-4 h-4" aria-hidden="true" />
                    {imageBusy === format ? ts("image.preparing") : ts(`image.${format}`)}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-slate-500">{ts("image.hint")}</p>
            </div>
          )}

          {/* Listing in Explore and stopping the link: owner only. */}
          {canManageSharing && (
            <>
              {/* Submit to Trending */}
              {exploreEnabled && (
                <div className="p-4 bg-gradient-to-r from-amber-50 to-orange-50 rounded-xl border border-amber-100">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
                        {trendingEnabled ? <Globe className="w-5 h-5 text-white" /> : <TrendingUp className="w-5 h-5 text-white" />}
                      </div>
                      <div>
                        <p id="explore-switch-label" className="text-sm font-semibold text-slate-900">
                          {trendingEnabled ? ts("explore.listedOn") : ts("explore.submitTo")}
                        </p>
                        <p className="text-xs text-slate-500">
                          {trendingEnabled ? ts("explore.visibleInGallery") : ts("explore.letOthersDiscover")}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={handleTrendingToggle}
                      disabled={trendingLoading}
                      role="switch"
                      aria-checked={trendingEnabled}
                      aria-labelledby="explore-switch-label"
                      className={cn(
                        "relative w-12 h-7 rounded-full transition-colors",
                        trendingEnabled ? "bg-gradient-to-r from-amber-500 to-orange-500" : "bg-slate-200",
                        trendingLoading && "opacity-50 cursor-not-allowed"
                      )}
                    >
                      <span className={cn("absolute left-0 top-1 w-5 h-5 bg-white rounded-full shadow transition-transform", trendingEnabled ? "translate-x-6" : "translate-x-1")} />
                    </button>
                  </div>
                </div>
              )}

              {/* Stop Sharing */}
              <div className="border-t border-slate-200 pt-4">
                {!showStopConfirm ? (
                  <button onClick={() => setShowStopConfirm(true)} className="text-sm text-red-600 hover:text-red-700 font-medium">
                    {ts("stopSharing.button")}
                  </button>
                ) : (
                  <div className="bg-red-50 rounded-lg p-4">
                    <p className="text-sm text-red-800 mb-3">{ts("stopSharing.confirmMessage")}</p>
                    <div className="flex items-center gap-2">
                      <button onClick={() => setShowStopConfirm(false)} className="px-3 py-1.5 text-sm font-medium text-slate-700 bg-white hover:bg-slate-100 rounded-lg transition-colors border border-slate-200">
                        {tb("cancel")}
                      </button>
                      <button onClick={onStopSharing} disabled={isLoading} className="px-3 py-1.5 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors disabled:opacity-50">
                        {isLoading ? ts("stopSharing.stopping") : ts("stopSharing.stop")}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
