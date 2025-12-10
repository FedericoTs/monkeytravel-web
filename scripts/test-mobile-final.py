#!/usr/bin/env python3
"""
Final Mobile UI Testing - Multiple Viewports
Tests the app on various mobile screen sizes for comprehensive coverage.
"""

from playwright.sync_api import sync_playwright
import os

OUTPUT_DIR = "/tmp/mobile-final"
os.makedirs(OUTPUT_DIR, exist_ok=True)

# Test multiple screen sizes
VIEWPORTS = [
    ("iphone_se", 375, 667),       # Smallest common iPhone
    ("iphone_14", 390, 844),       # Standard iPhone
    ("iphone_14_max", 430, 932),   # Largest iPhone
    ("android_sm", 360, 640),      # Small Android
    ("android_lg", 412, 915),      # Large Android (Pixel)
]

def test_viewport(p, name, width, height):
    print(f"\n{'='*50}")
    print(f"Testing: {name} ({width}x{height})")
    print("="*50)

    browser = p.chromium.launch(headless=True)
    context = browser.new_context(
        viewport={"width": width, "height": height},
        device_scale_factor=2,
        is_mobile=True,
        has_touch=True,
    )
    page = context.new_page()
    page.set_default_timeout(20000)

    issues = []

    try:
        # Test 1: Trip Creation Step 1
        page.goto("https://monkeytravel.app/trips/new", wait_until="networkidle")
        page.wait_for_timeout(1000)
        page.screenshot(path=f"{OUTPUT_DIR}/{name}_step1.png")
        print(f"  ✓ Step 1 captured")

        # Check for horizontal overflow
        scroll_width = page.evaluate("document.documentElement.scrollWidth")
        viewport_width = page.evaluate("window.innerWidth")
        if scroll_width > viewport_width + 5:
            issues.append(f"Horizontal overflow detected: {scroll_width}px > {viewport_width}px")

        # Select destination
        tokyo = page.locator("button:has-text('Tokyo')").first
        if tokyo.is_visible(timeout=3000):
            tokyo.click()
            page.wait_for_timeout(500)

        # Continue to Step 2
        continue_btn = page.locator("button:has-text('Continue')").first
        if continue_btn.is_visible(timeout=3000) and continue_btn.is_enabled():
            continue_btn.click()
            page.wait_for_timeout(1000)
            page.screenshot(path=f"{OUTPUT_DIR}/{name}_step2.png")
            print(f"  ✓ Step 2 captured")

            # Fill dates
            date_inputs = page.locator("input[type='date']").all()
            if len(date_inputs) >= 2:
                date_inputs[0].fill("2025-02-01")
                date_inputs[1].fill("2025-02-05")
                page.wait_for_timeout(500)

        # Continue to Step 3 (Vibes)
        continue_btn = page.locator("button:has-text('Continue')").first
        if continue_btn.is_visible(timeout=3000) and continue_btn.is_enabled():
            continue_btn.click()
            page.wait_for_timeout(1000)
            page.screenshot(path=f"{OUTPUT_DIR}/{name}_step3_vibes.png")
            print(f"  ✓ Step 3 (Vibes) captured")

            # Check vibes selector isn't overflowing
            scroll_width = page.evaluate("document.documentElement.scrollWidth")
            if scroll_width > viewport_width + 5:
                issues.append(f"Vibes selector overflow: {scroll_width}px")

        # Test Auth pages
        page.goto("https://monkeytravel.app/auth/login", wait_until="networkidle")
        page.wait_for_timeout(800)
        page.screenshot(path=f"{OUTPUT_DIR}/{name}_login.png")
        print(f"  ✓ Login page captured")

        page.goto("https://monkeytravel.app/auth/signup", wait_until="networkidle")
        page.wait_for_timeout(800)
        page.screenshot(path=f"{OUTPUT_DIR}/{name}_signup.png")
        print(f"  ✓ Signup page captured")

        # Check form doesn't overflow
        scroll_width = page.evaluate("document.documentElement.scrollWidth")
        if scroll_width > viewport_width + 5:
            issues.append(f"Signup form overflow: {scroll_width}px")

    except Exception as e:
        issues.append(f"Error: {str(e)}")
        page.screenshot(path=f"{OUTPUT_DIR}/{name}_error.png")

    finally:
        browser.close()

    if issues:
        print(f"\n  ⚠️ Issues found:")
        for issue in issues:
            print(f"     - {issue}")
    else:
        print(f"\n  ✓ No issues found!")

    return issues

def main():
    print("="*60)
    print("FINAL MOBILE UI ANALYSIS")
    print("="*60)

    all_issues = {}

    with sync_playwright() as p:
        for name, width, height in VIEWPORTS:
            issues = test_viewport(p, name, width, height)
            if issues:
                all_issues[name] = issues

    # Summary
    print("\n" + "="*60)
    print("SUMMARY")
    print("="*60)

    if all_issues:
        print("\n⚠️ Issues found on some viewports:")
        for viewport, issues in all_issues.items():
            print(f"\n  {viewport}:")
            for issue in issues:
                print(f"    - {issue}")
    else:
        print("\n✅ ALL VIEWPORTS PASSED!")
        print("   No horizontal overflow or rendering issues detected.")

    # List screenshots
    print(f"\n📸 Screenshots saved to: {OUTPUT_DIR}")
    screenshots = sorted(os.listdir(OUTPUT_DIR))
    for s in screenshots:
        size = os.path.getsize(f"{OUTPUT_DIR}/{s}") // 1024
        print(f"   - {s} ({size}KB)")

if __name__ == "__main__":
    main()
