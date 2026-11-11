/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import DurationSelect from "./DurationSelect";

/**
 * A stop's length starts at a quick look: a street or a passage on a walk is
 * five or ten minutes, and the list offers that.
 */

afterEach(cleanup);

describe("DurationSelect", () => {
  it("offers 5 and 10 minutes before the longer lengths", () => {
    render(<DurationSelect value={60} onChange={vi.fn()} label="Length" />);
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options.slice(0, 4)).toEqual(["5 min", "10 min", "15 min", "30 min"]);
  });

  it("keeps a stop's own length on the list when it isn't a usual one", () => {
    render(<DurationSelect value={20} onChange={vi.fn()} label="Length" />);
    expect((screen.getByRole("combobox", { name: "Length" }) as HTMLSelectElement).value).toBe("20");
  });
});
