// @vitest-environment node
import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * Coral as a text colour reads at about 2.7:1, under what words need
 * (DESIGN.md): it is for decoration. Screens move to the text colours a few at
 * a time, so the count of words set in coral can only go down: lower CEILING
 * when a change removes some. A hover or focus colour doesn't count, nor does
 * `--primary` on an icon.
 */
const CEILING = 81;

const CORAL_WORDS = /(?:^|[\s"'`{])(?:(?:sm|md|lg|xl|2xl):)?text-\[var\(--primary-ink\)\]/g;
const SCREEN = /^(app|components)\/.*\.tsx$/;
const TEST = /\.(vitest|spec)\.tsx$/;

// Screens already moved: none of their words may go back to coral.
const MOVED = [
  "components/ActivityCard.tsx",
  "components/explore/TripCard.tsx",
  "components/ui/MobileBottomNav.tsx",
  "app/[locale]/blog/tag/[tag]/page.tsx",
  "components/trip/TodayView.tsx",
  "components/trip/OngoingTripView.tsx",
  "components/trip/AddActivityButton.tsx",
  "components/trip/ItineraryDnd.tsx",
  "components/trip/ShareAndInviteModal.tsx",
  "components/trip/InviteTab.tsx",
  "components/trip/DaySummary.tsx",
  "components/trip/TripNotices.tsx",
  "components/collaboration/CollaboratorRow.tsx",
  "components/collaboration/proposals/ProposeActivitySheet.tsx",
  "components/collaboration/RoleSelector.tsx",
  "components/trip/TodayExpenses.tsx",
  "app/[locale]/(app)/trips/[id]/TripDetailClient.tsx",
  "app/[locale]/(app)/shared/[token]/SharedTripView.tsx",
  "components/trip/ParticipantsBar.tsx",
  "components/trip/WhoIsGoingCard.tsx",
  "app/[locale]/(app)/profile/ProfileClient.tsx",
  "app/[locale]/(app)/invite/[token]/InviteAcceptClient.tsx",
  "components/onboarding/DietaryStep.tsx",
  "components/onboarding/AccessibilityStep.tsx",
  "components/ui/PullToRefreshIndicator.tsx",
  "components/profile/ProfileCompletionModal.tsx",
  "components/creator/CreatorProfile.tsx",
  "components/trip/GenerationProgress.tsx",
  "components/trip/AnchorEditor.tsx",
  "components/wizard/TripDatesField.tsx",
  "components/wizard/PreferencesStep.tsx",
  "components/ui/SaveTripModal.tsx",
  "components/TripMap.tsx",
  "components/wizard/TripOptions.tsx",
  "components/wizard/ReturningUserBanner.tsx",
  "components/trip/VibeSelector.tsx",
  "components/ui/DateRangePicker.tsx",
  "components/ui/ActivityDetailSheet.tsx",
  "components/trip/RegenerateButton.tsx",
  "components/trip/AnonymousShareButton.tsx",
  "components/ui/Toast.tsx",
  "components/trip/ShareAfterSaveModal.tsx",
  "components/trip/ValuePropositionBanner.tsx",
];

const count = (file: string) => (readFileSync(file, "utf8").match(CORAL_WORDS) ?? []).length;

describe("words set in coral", () => {
  it(`stay at or under ${CEILING} across the screens`, () => {
    const files = execSync("git ls-files", { encoding: "utf8" })
      .split("\n")
      .filter((f) => SCREEN.test(f) && !TEST.test(f));
    const found = files.map((file) => ({ file, n: count(file) })).filter((x) => x.n > 0);
    const total = found.reduce((sum, x) => sum + x.n, 0);
    expect(total, `${total} uses of coral as a text colour (ceiling ${CEILING}): use --foreground or --foreground-muted for words`).toBeLessThanOrEqual(CEILING);
  });

  it.each(MOVED)("%s has none", (file) => {
    expect(count(file)).toBe(0);
  });

  it("counts a colour at rest, at any screen width, and not a hover or focus colour", () => {
    const n = (text: string) => (text.match(CORAL_WORDS) ?? []).length;
    expect(n('className="font-medium text-[var(--primary-ink)]"')).toBe(1);
    expect(n('className="md:text-[var(--primary-ink)]"')).toBe(1);
    expect(n('active ? "text-[var(--primary-ink)]" : "text-slate-500"')).toBe(1);
    expect(n('className="hover:text-[var(--primary-ink)] group-hover:text-[var(--primary-ink)]"')).toBe(0);
    expect(n('className="w-4 h-4 text-[var(--primary)]"')).toBe(0);
  });
});
