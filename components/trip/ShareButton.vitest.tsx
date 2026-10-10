/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ShareButton from "./ShareButton";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/components/collaboration/CollaboratorAvatars", () => ({ CollaboratorAvatars: () => null }));
vi.mock("@/lib/analytics", () => ({ trackTripShared: vi.fn() }));
// The modal has its own tests; here it only reports whether it is open, on which tab, the Explore state and the link.
vi.mock("./ShareAndInviteModal", () => ({
  default: ({ isOpen, initialTab, isInTrending, exploreEnabled, shareUrl, onClose, onRequestPublish, onStopSharing }: { isOpen: boolean; initialTab: string; isInTrending: boolean; exploreEnabled?: boolean; shareUrl: string; onClose: () => void; onRequestPublish?: () => void; onStopSharing: () => void }) =>
    isOpen ? (
      <div role="dialog" data-tab={initialTab} data-trending={String(isInTrending)} data-explore={String(exploreEnabled)} data-url={shareUrl}>
        <button onClick={onClose}>close</button>
        <button onClick={onRequestPublish}>list in explore</button>
        <button onClick={onStopSharing}>stop sharing</button>
      </div>
    ) : null,
}));
vi.mock("@/components/explore/PublishTripModal", () => ({
  default: ({ isOpen, onClose, onPublished }: { isOpen: boolean; onClose: () => void; onPublished?: (d: { tripId: string; shareToken: string }) => void }) =>
    isOpen ? (
      <div role="alertdialog">
        <button onClick={() => { onPublished?.({ tripId: "trip-1", shareToken: "t" }); onClose(); }}>publish</button>
      </div>
    ) : null,
}));

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ isShared: false, shareUrl: null, collaborators: [] }) }))
  );
});

/** The live trip view has no share button, so its share requests mount the modal alone. */
describe("ShareButton modal variant", () => {
  it("opens on the requested tab without rendering a share button", () => {
    render(<ShareButton tripId="trip-1" tripTitle="Lisbon" variant="modal" autoOpen initialTab="invite" />);
    expect(screen.getByRole("dialog").getAttribute("data-tab")).toBe("invite");
    expect(screen.queryByRole("button", { name: "share" })).toBeNull();
  });

  it("renders nothing until opened, and closes like the others", () => {
    const { container } = render(<ShareButton tripId="trip-1" tripTitle="Lisbon" variant="modal" />);
    expect(container.innerHTML).toBe("");
    render(<ShareButton tripId="trip-2" tripTitle="Porto" variant="modal" autoOpen />);
    fireEvent.click(screen.getByRole("button", { name: "close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("leaves the default button as it was", () => {
    render(<ShareButton tripId="trip-1" tripTitle="Lisbon" />);
    fireEvent.click(screen.getByRole("button", { name: "share" }));
    expect(screen.getByRole("dialog").getAttribute("data-tab")).toBe("share");
  });
});

describe("ShareButton Explore state", () => {
  it("starts the Explore switch from the saved status, not always off", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ isShared: true, isInTrending: true, shareUrl: "https://x/s/1", collaborators: [] }) }))
    );
    render(<ShareButton tripId="trip-1" tripTitle="Lisbon" variant="modal" autoOpen />);
    await waitFor(() => expect(screen.getByRole("dialog").getAttribute("data-trending")).toBe("true"));
  });

  it("offers Explore once the status says it's on", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ isShared: true, exploreEnabled: true, shareUrl: "https://x/s/1", collaborators: [] }) }))
    );
    render(<ShareButton tripId="trip-1" tripTitle="Lisbon" variant="modal" autoOpen />);
    expect(screen.getByRole("dialog").getAttribute("data-explore")).toBe("false");
    await waitFor(() => expect(screen.getByRole("dialog").getAttribute("data-explore")).toBe("true"));
  });
});

describe("ShareButton listing in Explore", () => {
  it("hands the switch to the publish modal and shows the trip listed after it publishes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ isShared: true, isInTrending: false, shareUrl: "https://x/s/1", collaborators: [] }) }))
    );
    render(<ShareButton tripId="trip-1" tripTitle="Lisbon" />);
    fireEvent.click(screen.getByRole("button", { name: /^shared?$/ }));
    await waitFor(() => expect(screen.getByRole("dialog").getAttribute("data-trending")).toBe("false"));

    fireEvent.click(screen.getByRole("button", { name: "list in explore" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "publish" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /^shared?$/ }));
    expect(screen.getByRole("dialog").getAttribute("data-trending")).toBe("true");
  });

  it("shows the trip off Explore once sharing stops, without a reload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => ({
        ok: true,
        json: async () =>
          init?.method === "DELETE"
            ? { success: true }
            : { isShared: true, isInTrending: true, shareUrl: "https://x/s/1", collaborators: [] },
      }))
    );
    render(<ShareButton tripId="trip-1" tripTitle="Lisbon" />);
    fireEvent.click(screen.getByRole("button", { name: /^shared?$/ }));
    await waitFor(() => expect(screen.getByRole("dialog").getAttribute("data-trending")).toBe("true"));

    fireEvent.click(screen.getByRole("button", { name: "stop sharing" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: /^shared?$/ }));
    expect(screen.getByRole("dialog").getAttribute("data-trending")).toBe("false");
  });
});

describe("ShareButton share link", () => {
  // Unpublishing gives the link a new token, also from the trip page's toggle.
  it("reads the link again when the window opens", async () => {
    let shareUrl = "https://x/shared/old-token";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ isShared: true, shareUrl, collaborators: [] }) }))
    );
    render(<ShareButton tripId="trip-1" tripTitle="Lisbon" />);
    await waitFor(() => expect(screen.getByRole("button", { name: "shared" })).toBeTruthy());

    shareUrl = "https://x/shared/new-token";
    fireEvent.click(screen.getByRole("button", { name: "shared" }));
    await waitFor(() => expect(screen.getByRole("dialog").getAttribute("data-url")).toBe("https://x/shared/new-token"));
  });
});
