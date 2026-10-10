/** @vitest-environment jsdom */
/**
 * The share window in Italian: a role change names the role the way the role
 * picker does, and a refused invite says why in the window's language instead
 * of passing on the route's English.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import itCommon from "@/messages/it/common.json";
import type { CollaboratorRole, TripCollaborator } from "@/types";
import ShareAndInviteModal from "./ShareAndInviteModal";

vi.mock("@/lib/native/share", () => ({ shareFile: vi.fn() }));
vi.mock("@/lib/posthog/events", () => ({ captureTripCardShared: vi.fn() }));
vi.mock("@/lib/analytics", () => ({
  trackShareModalOpened: vi.fn(),
  trackTripShared: vi.fn(),
  trackReferralLinkClicked: vi.fn(),
}));
const { addToast } = vi.hoisted(() => ({ addToast: vi.fn() }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ addToast }) }));
vi.mock("@/lib/hooks/useModalBehavior", () => ({ useModalBehavior: () => undefined, default: () => undefined }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user: { id: "owner-1" } }) }));
vi.mock("@/lib/native/external-link", () => ({ openExternal: vi.fn() }));
vi.mock("@/components/collaboration/RoleSelector", () => ({ RoleSelector: () => null }));
// One button per member that makes them a voter.
vi.mock("@/components/collaboration/CollaboratorRow", () => ({
  CollaboratorRow: ({
    collaborator,
    onRoleChange,
  }: {
    collaborator: TripCollaborator;
    onRoleChange?: (userId: string, role: CollaboratorRole) => Promise<void>;
  }) => <button onClick={() => onRoleChange?.(collaborator.user_id, "voter")}>{`make ${collaborator.display_name} a voter`}</button>,
}));
vi.mock("@/components/ui/BottomSheet", () => ({ default: ({ children }: { children: ReactNode }) => <div>{children}</div> }));

const member: TripCollaborator = {
  id: "c1",
  trip_id: "trip-1",
  user_id: "member-1",
  role: "editor",
  invited_by: "owner-1",
  joined_at: "2026-10-01T00:00:00Z",
  display_name: "Bea",
  avatar_url: null,
};

const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });

beforeEach(() => {
  addToast.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/collaborators") && !init?.method) return json(200, { collaborators: [member] });
      if (url.includes("/collaborators/") && init?.method === "PATCH") return json(200, {});
      if (url.endsWith("/invites") && init?.method === "POST") return json(400, { error: "Invalid recipient_email format" });
      return json(200, {});
    })
  );
});

function renderInviteTab() {
  return render(
    <NextIntlClientProvider locale="it" messages={{ common: itCommon }}>
      <ShareAndInviteModal
        isOpen
        onClose={vi.fn()}
        tripId="trip-1"
        tripTitle="Lisbon Trip"
        shareUrl="https://monkeytravel.app/shared/11111111-2222-3333-4444-555555555555"
        isShared
        onStopSharing={vi.fn()}
        onEnableSharing={vi.fn(async () => undefined)}
        isLoading={false}
        initialTab="invite"
      />
    </NextIntlClientProvider>
  );
}

describe("ShareAndInviteModal in Italian", () => {
  it("names the new role the way the role picker does", async () => {
    renderInviteTab();
    fireEvent.click(await screen.findByText("make Bea a voter"));
    await waitFor(() => expect(addToast).toHaveBeenCalledWith("Ruolo aggiornato a Votante", "success"));
  });

  it("says a typed address is wrong instead of showing the route's English", async () => {
    renderInviteTab();
    fireEvent.change(screen.getByPlaceholderText("friend@example.com"), { target: { value: "bea@" } });
    fireEvent.click(screen.getByText(itCommon.share.inviteEmail.send));
    await waitFor(() => expect(addToast).toHaveBeenCalledWith(itCommon.share.toast.inviteEmailInvalid, "error"));
    expect(addToast).not.toHaveBeenCalledWith(expect.stringContaining("recipient_email"), expect.anything());
  });
});
