/** @vitest-environment jsdom */
import { createRef, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

/**
 * A link prefetches its page only once someone shows they may open it, not
 * whenever it is on screen. The prefetch prop next-intl's Link receives is
 * what decides it, so the stand-in below shows it on the anchor.
 */

type Handlers = {
  onClick: (event: { currentTarget: { href: string } }) => void;
  onNavigate: (event: { preventDefault: () => void }) => void;
};
const handlers = vi.hoisted(() => new Map<string, Handlers>());
vi.mock("./navigation", () => ({
  NavigationLink: ({
    prefetch,
    children,
    onClick,
    onNavigate,
    ...props
  }: { prefetch?: boolean | "auto" | null; children: ReactNode; href: string } & Handlers) => {
    handlers.set(props.href, { onClick, onNavigate });
    return (
      <a data-prefetch={String(prefetch)} {...props}>
        {children}
      </a>
    );
  },
}));
const cue = vi.hoisted(() => vi.fn());
vi.mock("@/lib/navigation-cue", () => ({ startNavigationCue: cue }));

import { Link } from "./link";

const prefetchOf = (text: string) => screen.getByText(text).getAttribute("data-prefetch");

describe("Link", () => {
  it("does not prefetch while it only sits on screen", () => {
    render(<Link href="/blog">Blog</Link>);
    expect(prefetchOf("Blog")).toBe("false");
  });

  it("prefetches once the pointer is over it, it has keyboard focus, or it is touched", () => {
    render(
      <>
        <Link href="/a">Hover</Link>
        <Link href="/b">Focus</Link>
        <Link href="/c">Touch</Link>
      </>,
    );
    fireEvent.mouseEnter(screen.getByText("Hover"));
    fireEvent.focus(screen.getByText("Focus"));
    fireEvent.touchStart(screen.getByText("Touch"));
    expect([prefetchOf("Hover"), prefetchOf("Focus"), prefetchOf("Touch")]).toEqual(["null", "null", "null"]);
  });

  it("keeps a prefetch it is given", () => {
    render(
      <>
        <Link href="/a" prefetch={false}>
          Never
        </Link>
        <Link href="/b" prefetch>
          Always
        </Link>
      </>,
    );
    fireEvent.mouseEnter(screen.getByText("Never"));
    expect([prefetchOf("Never"), prefetchOf("Always")]).toEqual(["false", "true"]);
  });

  it("still calls the handlers it was given", () => {
    const onMouseEnter = vi.fn();
    const onFocus = vi.fn();
    render(
      <Link href="/a" onMouseEnter={onMouseEnter} onFocus={onFocus}>
        Trip
      </Link>,
    );
    fireEvent.mouseEnter(screen.getByText("Trip"));
    fireEvent.focus(screen.getByText("Trip"));
    expect(onMouseEnter).toHaveBeenCalledTimes(1);
    expect(onFocus).toHaveBeenCalledTimes(1);
  });

  it("hands a ref on to the anchor", () => {
    const ref = createRef<HTMLAnchorElement>();
    render(
      <Link href="/a" ref={ref}>
        Ref
      </Link>,
    );
    expect(ref.current?.tagName).toBe("A");
  });
});

describe("Link and the bar that follows a tap", () => {
  const tap = (href: string, address: string) => {
    handlers.get(href)!.onClick({ currentTarget: { href: address } });
    const prevent = vi.fn();
    handlers.get(href)!.onNavigate({ preventDefault: prevent });
    return prevent;
  };

  it("starts the bar for the page the tap asked for, once next/link navigates", () => {
    cue.mockClear();
    render(<Link href="/trips/1">Trip</Link>);
    tap("/trips/1", "https://monkeytravel.app/en/trips/1");
    expect(cue).toHaveBeenCalledWith("https://monkeytravel.app/en/trips/1");
  });

  it("keeps the caller's own handlers", () => {
    cue.mockClear();
    const clicked = vi.fn();
    const navigated = vi.fn();
    render(
      <Link href="/trips/2" onClick={clicked} onNavigate={navigated}>
        Trip
      </Link>,
    );
    tap("/trips/2", "https://monkeytravel.app/en/trips/2");
    expect(clicked).toHaveBeenCalledTimes(1);
    expect(navigated).toHaveBeenCalledTimes(1);
    expect(cue).toHaveBeenCalledTimes(1);
  });

  it("leaves the bar alone when the caller stops the navigation", () => {
    cue.mockClear();
    render(
      <Link href="/trips/3" onNavigate={(event) => event.preventDefault()}>
        Trip
      </Link>,
    );
    const prevent = tap("/trips/3", "https://monkeytravel.app/en/trips/3");
    expect(prevent).toHaveBeenCalled();
    expect(cue).not.toHaveBeenCalled();
  });
});
