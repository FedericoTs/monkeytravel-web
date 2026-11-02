import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enBananas from "@/messages/en/bananas.json";
import enCommon from "@/messages/en/common.json";
import ReferralProgressBanner from "./ReferralProgressBanner";

const STORAGE_KEY = "referral_banner_dismissed";

function Banner() {
  return (
    <NextIntlClientProvider locale="en" messages={{ bananas: enBananas, common: enCommon }}>
      <ReferralProgressBanner lifetimeConversions={1} />
    </NextIntlClientProvider>
  );
}

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = container = undefined;
  cleanup();
  localStorage.clear();
});

/** Hydrates the server HTML, with `dismissed` stored in the browser only, as on a real visit. */
async function hydrate(dismissed: boolean) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  container.innerHTML = renderToString(<Banner />);
  document.body.appendChild(container);
  if (dismissed) localStorage.setItem(STORAGE_KEY, "true");
  const errors: unknown[] = [];
  await act(async () => {
    root = hydrateRoot(container!, <Banner />, { onRecoverableError: (e) => errors.push(e) });
  });
  return { container, errors };
}

describe("ReferralProgressBanner", () => {
  it("holds its space in the server HTML", () => {
    const html = renderToString(<Banner />);
    expect(html).toContain("min-h-[64px]");
    expect(html).not.toContain(enBananas.banner.title);
  });

  it("hydrates without a mismatch, then shows the banner", async () => {
    const { container, errors } = await hydrate(false);
    expect(errors).toEqual([]);
    expect(container.textContent).toContain(enBananas.banner.title);
  });

  it("hydrates without a mismatch, then shows nothing once dismissed", async () => {
    const { container, errors } = await hydrate(true);
    expect(errors).toEqual([]);
    expect(container.innerHTML).toBe("");
  });

  it("stays dismissed", () => {
    const first = render(<Banner />);
    fireEvent.click(screen.getByRole("button", { name: enCommon.a11y.dismiss }));
    expect(first.container.innerHTML).toBe("");
    first.unmount();
    expect(render(<Banner />).container.innerHTML).toBe("");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("true");
  });
});
