import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("next/dynamic", async () => {
  const modal = await import("@/components/ui/BaseModal");
  return { default: () => modal.default };
});

import RegenerateConfirmModal from "./RegenerateConfirmModal";

describe("RegenerateConfirmModal", () => {
  it("asks only while open, above the result bar; keeping closes it, regenerating regenerates", async () => {
    const onClose = vi.fn();
    const onRegenerate = vi.fn();
    const { rerender } = render(<RegenerateConfirmModal isOpen={false} onClose={onClose} onRegenerate={onRegenerate} />);
    expect(screen.queryByText("wizard.regenerateConfirm.body")).toBeNull();

    rerender(<RegenerateConfirmModal isOpen onClose={onClose} onRegenerate={onRegenerate} />);
    await screen.findByText("wizard.regenerateConfirm.body");
    expect(screen.getByRole("dialog").style.zIndex).toBe("100");
    fireEvent.click(screen.getByRole("button", { name: "wizard.regenerateConfirm.keep" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onRegenerate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "wizard.regenerateConfirm.regenerate" }));
    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });
});
