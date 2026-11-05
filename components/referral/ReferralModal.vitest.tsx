/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import ReferralModal from "./ReferralModal";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/lib/native/external-link", () => ({ openExternal: vi.fn() }));

const ok = () => new Response(JSON.stringify({ code: "OWNER1", stats: { clicks: 47, signups: 20, conversions: 13 } }), { status: 200 });
const refused = () => new Response(JSON.stringify({ error: "Sign in first" }), { status: 401 });

const send = vi.fn<() => Promise<Response>>();
const show = (isOpen = true) => <ReferralModal isOpen={isOpen} onClose={() => {}} />;

beforeEach(() => {
  send.mockReset();
  send.mockImplementation(async () => ok());
  vi.stubGlobal("fetch", send);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the referral window", () => {
  it("shows nothing and asks for nothing while closed", () => {
    render(show(false));
    expect(screen.queryByText("title")).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it("reads the code when it opens, and shows the link and the stats", async () => {
    render(show());
    expect(send).toHaveBeenCalledExactlyOnceWith("/api/referral/code");
    expect(screen.queryByText("howItWorks")).toBeNull();
    await screen.findByText("howItWorks");
    expect((screen.getByDisplayValue(/\/join\/OWNER1$/) as HTMLInputElement).readOnly).toBe(true);
    expect(screen.getByText("47")).toBeTruthy();
    expect(screen.getByText("13")).toBeTruthy();
  });

  it("reads it again each time it opens", async () => {
    const view = render(show());
    await screen.findByText("howItWorks");
    view.rerender(show(false));
    expect(screen.queryByText("howItWorks")).toBeNull();
    view.rerender(show());
    expect(send).toHaveBeenCalledTimes(2);
    await screen.findByText("howItWorks");
  });

  it("says what went wrong, in the route's words, and can try again", async () => {
    send.mockImplementationOnce(async () => refused());
    render(show());
    await screen.findByText("Sign in first");
    expect(screen.queryByText("howItWorks")).toBeNull();

    fireEvent.click(screen.getByText("tryAgain"));
    expect(screen.queryByText("Sign in first")).toBeNull();
    expect(send).toHaveBeenCalledTimes(2);
    await screen.findByText("howItWorks");
  });

  it("has words of its own when the route gives none, or can't be reached", async () => {
    send.mockImplementationOnce(async () => new Response(JSON.stringify({}), { status: 500 }));
    const view = render(show());
    await screen.findByText("Failed to get referral code");
    view.unmount();

    send.mockImplementationOnce(async () => {
      throw "offline";
    });
    render(show());
    await waitFor(() => expect(screen.getByText("Something went wrong")).toBeTruthy());
  });
});
