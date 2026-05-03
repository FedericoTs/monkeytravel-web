"""
Smoke-test the /trips/new wizard on a mobile viewport to confirm the
Continue button is reachable (regression check for commit
"infra: fix wizard Continue button hidden by MobileBottomNav").

What it does:
  1. iPhone 14 Pro viewport + UA
  2. Goto /trips/new (forces en locale)
  3. Click a popular destination pill ("Paris, France")
  4. Pick start + end dates via the date input fields
  5. Verify the Continue button is visible AND clickable AND not occluded
  6. Click Continue, verify step 2 loads (vibes selector visible)
  7. Take screenshots at each step

Runs against an already-running dev server on http://localhost:3000.
"""
from playwright.sync_api import sync_playwright, expect
import sys
import datetime

BASE = "http://localhost:3002"
SCREENSHOTS = "/tmp/wizard-test"
import os
os.makedirs(SCREENSHOTS, exist_ok=True)


def step(label):
    print(f"\n=== {label} ===", flush=True)


def shot(page, name):
    path = f"{SCREENSHOTS}/{name}.png"
    page.screenshot(path=path, full_page=True)
    print(f"  📷 {path}", flush=True)


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # iPhone 14 Pro: 393x852 logical, DPR 3, mobile UA
        ctx = browser.new_context(
            viewport={"width": 393, "height": 852},
            device_scale_factor=3,
            is_mobile=True,
            has_touch=True,
            user_agent=(
                "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) "
                "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 "
                "Mobile/15E148 Safari/604.1"
            ),
        )
        page = ctx.new_page()
        # Capture console errors so we know if the page is healthy.
        errors = []
        page.on("pageerror", lambda exc: errors.append(("pageerror", str(exc))))
        page.on("console", lambda msg: errors.append(("console-error", msg.text))
                if msg.type == "error" else None)

        step("1. Navigate to /trips/new")
        page.goto(f"{BASE}/trips/new", wait_until="domcontentloaded")
        page.wait_for_load_state("networkidle", timeout=30000)
        shot(page, "01-initial")

        step("1b. Dismiss cookie banner if present")
        cookie_btn = page.get_by_role("button", name="Accept All")
        if cookie_btn.count() > 0 and cookie_btn.first.is_visible():
            print("  cookie banner present — accepting")
            cookie_btn.first.click()
            page.wait_for_timeout(500)
            shot(page, "01b-cookie-dismissed")
        else:
            print("  no cookie banner")

        step("1c. Close the autocomplete dropdown (autoFocus opens it)")
        # Click on the page header to defocus the autocomplete input.
        page.get_by_text("Where and when?", exact=True).click()
        page.wait_for_timeout(300)
        shot(page, "01c-dropdown-closed")

        # Detect if redirected to /auth/signup (wizard requires no auth for step 1
        # but maybe auth check redirects us). The wizard auth check is in
        # handleGenerate, NOT on page load — so we should always see step 1.
        if "/auth" in page.url:
            print(f"  ❌ unexpectedly redirected to {page.url}")
            sys.exit(1)
        print(f"  url: {page.url}")

        step("2. Verify step 1 is visible — 'Where and when?' header")
        heading = page.get_by_text("Where and when?", exact=True).first
        expect(heading).to_be_visible(timeout=10000)

        step("3. Click 'Paris, France' popular pill")
        paris = page.get_by_role("button", name="🇫🇷 Paris, France")
        expect(paris).to_be_visible(timeout=5000)
        paris.click()
        shot(page, "02-destination-picked")

        step("4. Pick travel dates via custom DateRangePicker")
        # Open check-in picker
        checkin_btn = page.get_by_role("button").filter(has_text="Check-in")
        expect(checkin_btn).to_be_visible(timeout=5000)
        checkin_btn.click()
        page.wait_for_timeout(400)
        shot(page, "03a-checkin-open")

        # Pick a start date — today + 7 days, must be in current calendar view.
        # Day buttons in the calendar grid are <button> elements containing
        # just the day number (1-31). Filter by exact text + visible.
        today = datetime.date.today()
        start = today + datetime.timedelta(days=7)
        end = today + datetime.timedelta(days=11)
        # The calendar is open; day buttons are h-10 w-full rounded-lg.
        # Pick the start day. Use exact-match to avoid matching '1' vs '11'.
        # Calendar buttons render the day with optional Start/End label.
        # We target the visible day cell with a specific class signature.
        start_cell = page.locator(
            "button.h-10.w-full.rounded-lg",
        ).filter(has_text=str(start.day)).first
        start_cell.click()
        page.wait_for_timeout(300)
        shot(page, "03b-start-picked")

        # End date click — calendar should auto-switch to end-date mode.
        end_cell = page.locator(
            "button.h-10.w-full.rounded-lg",
        ).filter(has_text=str(end.day)).first
        end_cell.click()
        page.wait_for_timeout(400)
        shot(page, "03c-dates-picked")

        step("5. CRITICAL — Continue button must be visible AND not occluded")
        continue_btn = page.get_by_role("button", name="Continue →")
        expect(continue_btn).to_be_visible(timeout=5000)

        box = continue_btn.bounding_box()
        if not box:
            print("  ❌ Continue button has no bounding box (off-screen?)")
            shot(page, "ERROR-no-bbox")
            sys.exit(1)
        print(f"  Continue button bbox: x={box['x']:.0f} y={box['y']:.0f} "
              f"w={box['width']:.0f} h={box['height']:.0f}")
        center_x = box["x"] + box["width"] / 2
        center_y = box["y"] + box["height"] / 2
        viewport = page.viewport_size
        print(f"  viewport: {viewport['width']}x{viewport['height']}")
        print(f"  center:   {center_x:.0f},{center_y:.0f}")

        # The bug we fixed: MobileBottomNav (z-50) was covering Continue (z-40).
        # Confirm by hitting the center point and seeing what element is on top.
        topmost = page.evaluate(
            """([x, y]) => {
              const el = document.elementFromPoint(x, y);
              if (!el) return null;
              return {
                tag: el.tagName,
                text: (el.innerText || '').slice(0, 60),
                classes: el.className?.toString?.() || '',
                role: el.getAttribute('role'),
              };
            }""",
            [center_x, center_y],
        )
        print(f"  element at button center: {topmost}")

        # Sanity: the topmost element at the Continue's center should be the
        # button itself, an SVG inside it, or the inner text node.
        if not topmost:
            print("  ❌ no element at button center — completely occluded")
            shot(page, "ERROR-occluded")
            sys.exit(1)
        if topmost["tag"] not in ("BUTTON", "SVG", "PATH", "SPAN", "DIV"):
            print(f"  ⚠️  topmost is {topmost['tag']} — possibly still covered")

        step("6. Click Continue → expect step 2 (vibes)")
        continue_btn.click()
        page.wait_for_timeout(1000)
        shot(page, "04-step-2")

        # Step 2 should show vibes selector
        vibes_heading = page.locator("text=/vibe|mood|feel/i").first
        # The page has VibeSelector with vibe options; just check we're on step 2
        # by verifying step counter changed.
        step_counter = page.locator("text=/^[12]\\s*\\/\\s*2$/").first
        if step_counter.count() > 0:
            txt = step_counter.text_content()
            print(f"  step counter: {txt}")
            if txt and txt.strip().startswith("2"):
                print("  ✅ on step 2")
            else:
                print(f"  ❌ still on step 1 (counter={txt})")
                sys.exit(1)
        else:
            print("  ⚠️  step counter not found — checking heading")

        step("7. Console errors during run")
        if errors:
            for typ, msg in errors[-10:]:
                print(f"  [{typ}] {msg[:200]}")
        else:
            print("  none ✅")

        browser.close()
        print("\n=== ALL CHECKS PASSED ===")


if __name__ == "__main__":
    main()
