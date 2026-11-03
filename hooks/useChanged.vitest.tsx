/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { useLayoutEffect, useState } from "react";
import { cleanup, render } from "@testing-library/react";
import { useChanged } from "./useChanged";

afterEach(cleanup);

/** A zoom that resets when the photo changes, recording what each commit showed. */
function Photo({ index, commits }: { index: number; commits: string[] }) {
  const [zoomed, setZoomed] = useState(true);
  if (useChanged(index)) setZoomed(false);
  useLayoutEffect(() => {
    commits.push(`photo ${index}, ${zoomed ? "zoomed" : "fit"}`);
  });
  return <p>{zoomed ? "zoomed" : "fit"}</p>;
}

describe("useChanged", () => {
  it("is false on the first render and while the value holds", () => {
    const commits: string[] = [];
    const { rerender } = render(<Photo index={0} commits={commits} />);
    rerender(<Photo index={0} commits={commits} />);
    expect(commits).toEqual(["photo 0, zoomed", "photo 0, zoomed"]);
  });

  it("lets state follow a change before anything commits", () => {
    const commits: string[] = [];
    const { rerender } = render(<Photo index={0} commits={commits} />);
    rerender(<Photo index={1} commits={commits} />);
    // No commit ever showed photo 1 zoomed.
    expect(commits).toEqual(["photo 0, zoomed", "photo 1, fit"]);
  });

  it("is true once per change", () => {
    const seen: boolean[] = [];
    function Probe({ value }: { value: string }) {
      seen.push(useChanged(value));
      return null;
    }
    const { rerender } = render(<Probe value="a" />);
    rerender(<Probe value="b" />);
    rerender(<Probe value="b" />);
    expect(seen.filter(Boolean)).toHaveLength(1);
  });

  it("settles on a key built from a list that is a new array every render", () => {
    let renders = 0;
    function List({ items = [] }: { items?: string[] }) {
      renders++;
      const [shown, setShown] = useState(items);
      if (useChanged(JSON.stringify(items)) && items.length > 0) setShown(items);
      return <p>{shown.join(",")}</p>;
    }
    const { rerender, container } = render(<List />);
    rerender(<List />);
    rerender(<List items={["passport"]} />);
    expect(container.textContent).toBe("passport");
    expect(renders).toBeLessThan(10);
  });
});
