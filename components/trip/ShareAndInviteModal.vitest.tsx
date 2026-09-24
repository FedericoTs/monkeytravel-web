/** @vitest-environment jsdom */
/**
 * The share tab's framing (2026-09-18): a trip planned "with friends" opens on
 * the crew ask — the link carries ?vote=1 and the recipient page leads with
 * the vote — while solo trips and unanswered intent open on the plain link.
 * The owner can flip either way, and whatever they copy is what they chose.
 *
 * Everything around the share tab (toast, auth, analytics, collaborators,
 * sheet chrome) is stubbed; the assertions are about which link is offered.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ShareAndInviteModal from "./ShareAndInviteModal";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/lib/analytics", () => ({
  trackShareModalOpened: vi.fn(),
  trackTripShared: vi.fn(),
  trackReferralLinkClicked: vi.fn(),
}));
vi.mock("@/components/ui/Toast", () => ({
  useToast: () => ({ addToast: vi.fn() }),
}));
vi.mock("@/lib/hooks/useModalBehavior", () => ({
  useModalBehavior: () => undefined,
  default: () => undefined,
}));
vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({ user: null }),
}));
vi.mock("@/lib/native/external-link", () => ({
  openExternal: vi.fn(),
}));
vi.mock("@/components/collaboration/RoleSelector", () => ({
  RoleSelector: () => null,
}));
vi.mock("@/components/collaboration/CollaboratorRow", () => ({
  CollaboratorRow: () => null,
}));
vi.mock("@/components/ui/BottomSheet", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const TOKEN = "11111111-2222-3333-4444-555555555555";
const SHARE_URL = `https://monkeytravel.app/shared/${TOKEN}?ref=ABC123`;
const CREW_URL = `${SHARE_URL}&vote=1`;

function renderModal(tripIntent?: "solo" | "group" | null) {
  return render(
    <ShareAndInviteModal
      isOpen
      onClose={vi.fn()}
      tripId="trip-1"
      tripTitle="Lisbon Trip"
      shareUrl={SHARE_URL}
      tripIntent={tripIntent}
      isShared
      onStopSharing={vi.fn()}
      onEnableSharing={vi.fn(async () => undefined)}
      isLoading={false}
    />
  );
}

/** The read-only link box on the share tab. */
function offeredLink(): string {
  return (screen.getByRole("textbox") as HTMLInputElement).value;
}

function checked(testId: string): string | null {
  return screen.getByTestId(testId).getAttribute("aria-checked");
}

function copyButton(): HTMLElement {
  // The link box's copy button: the first button after the read-only input.
  const buttons = Array.from(document.querySelectorAll("button"));
  const input = screen.getByRole("textbox");
  const button = buttons.find(
    (b) => b.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_PRECEDING && b.textContent?.includes("buttons.cop")
  );
  if (!button) {
    throw new Error("copy button not rendered; buttons: " + buttons.map((b) => JSON.stringify(b.textContent)).join(", "));
  }
  return button;
}

beforeEach(() => {
  // Any status the modal refreshes on open says the trip is shared, so the
  // share tab stays on the link box for the whole test.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ shareToken: TOKEN, shareUrl: SHARE_URL, isShared: true, collaborators: [], invites: [] }),
    }))
  );
});

describe("ShareAndInviteModal framing", () => {
  it("opens on the crew ask for a trip planned with friends", () => {
    renderModal("group");
    expect(offeredLink()).toBe(CREW_URL);
    expect(checked("share-framing-crew")).toBe("true");
    expect(checked("share-framing-plain")).toBe("false");
  });

  it("opens on the plain link for a solo trip and for an unanswered intent", () => {
    const { unmount } = renderModal("solo");
    expect(offeredLink()).toBe(SHARE_URL);
    expect(checked("share-framing-plain")).toBe("true");
    unmount();
    renderModal(undefined);
    expect(offeredLink()).toBe(SHARE_URL);
  });

  it("lets the owner flip the framing either way", () => {
    renderModal("group");
    fireEvent.click(screen.getByTestId("share-framing-plain"));
    expect(offeredLink()).toBe(SHARE_URL);
    fireEvent.click(screen.getByTestId("share-framing-crew"));
    expect(offeredLink()).toBe(CREW_URL);
  });

  it("copies the link that is on screen", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderModal("group");
    fireEvent.click(copyButton());
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(CREW_URL));
    fireEvent.click(screen.getByTestId("share-framing-plain"));
    fireEvent.click(copyButton());
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(SHARE_URL));
  });
});

/**
 * Collaborators (2026-09-24). Turning the link on or off and listing the trip
 * in Explore are the owner's (POST/DELETE /share and /submit-trending admit
 * only the owner), so an editor's click there used to fail silently. The
 * trip page passes canManageSharing={isOwner}; the default keeps the owner's
 * view exactly as before.
 */
describe("sharing controls for someone who is not the owner", () => {
  function renderAs(canManageSharing: boolean | undefined, isShared: boolean) {
    return render(
      <ShareAndInviteModal
        isOpen
        onClose={vi.fn()}
        tripId="trip-1"
        tripTitle="Lisbon Trip"
        shareUrl={isShared ? SHARE_URL : ""}
        isShared={isShared}
        onStopSharing={vi.fn()}
        onEnableSharing={vi.fn(async () => undefined)}
        isLoading={false}
        {...(canManageSharing === undefined ? {} : { canManageSharing })}
      />
    );
  }

  it("shows a note instead of Enable Sharing", () => {
    renderAs(false, false);
    expect(screen.queryByText("share.invite.enableSharingButton")).toBeNull();
    expect(screen.getByText("share.invite.ownerOnly")).toBeTruthy();
  });

  it("still offers the existing link, without Explore or Stop Sharing", () => {
    renderAs(false, true);
    expect(offeredLink()).toContain(TOKEN);
    expect(screen.queryByText("share.stopSharing.button")).toBeNull();
    expect(screen.queryByText("share.explore.submitTo")).toBeNull();
  });

  it("leaves the owner's view unchanged by default", () => {
    renderAs(undefined, false);
    expect(screen.getByText("share.invite.enableSharingButton")).toBeTruthy();
    expect(screen.queryByText("share.invite.ownerOnly")).toBeNull();
  });

  it("leaves the owner's Stop Sharing and Explore in place", () => {
    renderAs(undefined, true);
    expect(screen.getByText("share.stopSharing.button")).toBeTruthy();
    expect(screen.getByText("share.explore.submitTo")).toBeTruthy();
  });
});
