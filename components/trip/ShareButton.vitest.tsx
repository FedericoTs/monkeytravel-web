/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import ShareButton from "./ShareButton";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/components/collaboration/CollaboratorAvatars", () => ({ CollaboratorAvatars: () => null }));
vi.mock("@/lib/analytics", () => ({ trackTripShared: vi.fn() }));
// The modal has its own tests; here it only reports whether it is open and on which tab.
vi.mock("./ShareAndInviteModal", () => ({
  default: ({ isOpen, initialTab, onClose }: { isOpen: boolean; initialTab: string; onClose: () => void }) =>
    isOpen ? (
      <div role="dialog" data-tab={initialTab}>
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
