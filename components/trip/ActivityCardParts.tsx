import PlaceGallery from "@/components/PlaceGallery";
import type { Activity } from "@/types";
import type { ActivityType } from "@/lib/trip/activity-type";

/**
 * The glyph for an activity's kind in a card's time column and phone header:
 * restaurant, attraction, activity or transport. Other kinds have none.
 */
export function ActivityKindIcon({ kind, className }: { kind: ActivityType; className: string }) {
  switch (kind) {
    case "restaurant":
      return (
        <svg className={className} fill="currentColor" viewBox="0 0 20 20">
          <path d="M3 3a1 1 0 000 2h11a1 1 0 100-2H3zM3 7a1 1 0 000 2h7a1 1 0 100-2H3zM3 11a1 1 0 100 2h4a1 1 0 100-2H3zM15 8a1 1 0 10-2 0v5.586l-1.293-1.293a1 1 0 00-1.414 1.414l3 3a1 1 0 001.414 0l3-3a1 1 0 00-1.414-1.414L15 13.586V8z" />
        </svg>
      );
    case "attraction":
      return (
        <svg className={className} fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M4 4a2 2 0 012-2h8a2 2 0 012 2v12a1 1 0 110 2h-3a1 1 0 01-1-1v-2a1 1 0 00-1-1H9a1 1 0 00-1 1v2a1 1 0 01-1 1H4a1 1 0 110-2V4zm3 1h2v2H7V5zm2 4H7v2h2V9zm2-4h2v2h-2V5zm2 4h-2v2h2V9z" clipRule="evenodd" />
        </svg>
      );
    case "activity":
      return (
        <svg className={className} fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
        </svg>
      );
    case "transport":
      return (
        <svg className={className} fill="currentColor" viewBox="0 0 20 20">
          <path d="M8 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM15 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
          <path d="M3 4a1 1 0 00-1 1v10a1 1 0 001 1h1.05a2.5 2.5 0 014.9 0H10a1 1 0 001-1V5a1 1 0 00-1-1H3zM14 7a1 1 0 00-1 1v6.05A2.5 2.5 0 0115.95 16H17a1 1 0 001-1v-5a1 1 0 00-.293-.707l-2-2A1 1 0 0015 7h-1z" />
        </svg>
      );
    default:
      return null;
  }
}

/**
 * A card's expanded panel: the place's photos, when the gallery is on, and
 * the activity's insider tips under `tipsLabel`.
 */
export function ActivityCardDetails({
  activity,
  showGallery,
  disableAutoFetch,
  onPhotoCapture,
  tipsLabel,
}: {
  activity: Activity;
  showGallery: boolean;
  disableAutoFetch: boolean;
  onPhotoCapture: (photoUrl: string) => void;
  tipsLabel: string;
}) {
  return (
    <div className="border-t border-slate-100 p-3 sm:p-4 bg-slate-50/50 overflow-hidden">
      {showGallery && (
        <div className="mb-4 overflow-hidden max-w-full">
          <PlaceGallery
            placeName={activity.name}
            placeAddress={activity.address || activity.location}
            maxPhotos={5}
            showRating={true}
            disableAutoFetch={disableAutoFetch}
            onFirstPhotoFetched={onPhotoCapture}
            existingImageUrl={activity.image_url}
          />
        </div>
      )}

      {activity.tips && activity.tips.length > 0 && (
        <div className="bg-blue-50 rounded-lg p-3 border border-blue-100">
          <div className="flex items-center gap-2 text-sm font-medium text-blue-800 mb-2">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
            {tipsLabel}
          </div>
          <ul className="space-y-1">
            {activity.tips.map((tip, i) => (
              <li key={i} className="text-sm text-blue-700 flex items-start gap-2">
                <span className="text-blue-400 mt-1">•</span>
                {tip}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
