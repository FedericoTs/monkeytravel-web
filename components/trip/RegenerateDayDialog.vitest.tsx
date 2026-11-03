import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => (values ? `${key} ${JSON.stringify(values)}` : key),
}));
vi.mock("next/dynamic", async () => {
  const modal = await import("@/components/ui/BaseModal");
  return { default: () => modal.default };
});

import RegenerateDayDialog from "./RegenerateDayDialog";

afterEach(cleanup);

describe("RegenerateDayDialog", () => {
  it("stays closed without a day", () => {
    render(<RegenerateDayDialog prompt={null} onChange={vi.fn()} onRegenerate={vi.fn()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("asks about the day, keeps the steer as it is typed, and regenerates with it", async () => {
    const onChange = vi.fn();
    const onRegenerate = vi.fn();
    render(<RegenerateDayDialog prompt={{ dayNumber: 3, text: "boarding" }} onChange={onChange} onRegenerate={onRegenerate} />);
    await screen.findByText('detail.regenerateDay.title {"number":3}');
    fireEvent.change(screen.getByLabelText("detail.regenerateDay.label"), { target: { value: "boarding the cruise" } });
    expect(onChange).toHaveBeenLastCalledWith({ dayNumber: 3, text: "boarding the cruise" });

    fireEvent.click(screen.getByRole("button", { name: "detail.regenerateDay.confirm" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(onRegenerate).toHaveBeenCalledWith(3, "boarding");
  });

  it("closes without regenerating on cancel", async () => {
    const onChange = vi.fn();
    const onRegenerate = vi.fn();
    render(<RegenerateDayDialog prompt={{ dayNumber: 1, text: "" }} onChange={onChange} onRegenerate={onRegenerate} />);
    fireEvent.click(await screen.findByRole("button", { name: "detail.regenerateDay.cancel" }));
    expect(onChange).toHaveBeenCalledWith(null);
    expect(onRegenerate).not.toHaveBeenCalled();
  });
});
