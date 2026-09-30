/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ShareButton from "./ShareButton";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/components/collaboration/CollaboratorAvatars", () => ({ CollaboratorAvatars: () => null }));
vi.mock("@/lib/analytics", () => ({ trackTripShared: vi.fn() }));
// The modal has its own tests; here it only reports whether it is open, on which tab, and the Explore state.
vi.mock("./ShareAndInviteModal", () => ({
  default: ({ isOpen, initialTab, isInTrending, onClose }: { isOpen: boolean; initialTab: string; isInTrending: boolean; onClose: () => void }) =>
    isOpen ? (
      <div role="dialog" data-tab={initialTab} data-trending={String(isInTrending)}>
        <button onClick={onClose}>close</button>
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
});
