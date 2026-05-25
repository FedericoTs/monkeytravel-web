import { isExploreUgcEnabled } from "@/lib/explore/flag";
import { getTripViewerState } from "@/lib/explore/viewer-state";
import EngagementBar from "./EngagementBar";
import PublishToggle from "./PublishToggle";
import { createClient } from "@/lib/supabase/server";

interface TripEngagementSectionProps {
  tripId: string;
  /** Server-rendered initial counts read from the trips row. */
  likeCount: number;
  saveCount: number;
  forkCount: number;
  /** Whether the trip is publicly engagement-eligible (visibility=public + not hidden). */
  isPublic: boolean;
  /** Hides the Fork button + the auth-redirect (owners can't fork). */
  isOwner?: boolean;
  /** Owner-only: show the Publish toggle (private↔public flip). */
  showPublishToggle?: boolean;
  /** Owner profile name to prefill in the publish modal. */
  ownerDisplayName?: string;
}

/**
 * Server component that prepares the engagement-bar state + auth check
 * + flag check, then renders the client EngagementBar.
 *
 * If the explore feature flag is off, or the trip isn't public yet,
 * returns null — no UI is shown. This is intentional: we don't want
 * private trip pages to show dead Like / Save buttons.
 */
export default async function TripEngagementSection({
  tripId,
  likeCount,
  saveCount,
  forkCount,
  isPublic,
  isOwner = false,
  showPublishToggle = false,
  ownerDisplayName,
}: TripEngagementSectionProps) {
  // Owners always see their own engagement bar (so they can watch the
  // counters grow). Non-owners only see it when the trip is public.
  if (!isExploreUgcEnabled()) return null;
  if (!isPublic && !isOwner) return null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isAuthenticated = !!user;

  const viewerState = isPublic
    ? await getTripViewerState(tripId)
    : { hasLiked: false, hasSaved: false };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <EngagementBar
        tripId={tripId}
        likeCount={likeCount}
        saveCount={saveCount}
        forkCount={forkCount}
        initialLiked={viewerState.hasLiked}
        initialSaved={viewerState.hasSaved}
        isAuthenticated={isAuthenticated}
        isOwner={isOwner}
        showFork={!isOwner && isPublic}
      />
      {showPublishToggle && isOwner && (
        <PublishToggle
          tripId={tripId}
          isPublic={isPublic}
          defaultAuthorName={ownerDisplayName}
        />
      )}
    </div>
  );
}
