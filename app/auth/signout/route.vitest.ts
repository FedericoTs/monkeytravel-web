/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { signOut } = vi.hoisted(() => ({ signOut: vi.fn(async () => ({ error: null })) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { signOut } }) }));

import { POST } from "./route";

describe("POST /auth/signout", () => {
  it("signs out and sends the browser home with a GET", async () => {
    const res = await POST(
      new NextRequest("https://monkeytravel.app/auth/signout", {
        method: "POST",
        headers: { origin: "https://monkeytravel.app" },
      }),
    );
    expect(signOut).toHaveBeenCalledTimes(1);
    // 303 turns the POST into a GET; 307 would repeat the POST on the home page.
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://monkeytravel.app/");
  });
});
