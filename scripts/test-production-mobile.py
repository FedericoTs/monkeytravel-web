#!/usr/bin/env python3
"""
Production Mobile UI Testing Script
Tests the mobile UI of monkeytravel.app modals.
"""

from playwright.sync_api import sync_playwright
import os

OUTPUT_DIR = "/tmp/mobile-tests-prod"
os.makedirs(OUTPUT_DIR, exist_ok=True)

def main():
    print("Starting Production Mobile UI Tests...")
    print("Testing: https://monkeytravel.app")

    # iPhone 14 Pro viewport
    viewport = {"width": 390, "height": 844}

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            viewport=viewport,
            device_scale_factor=2,
            is_mobile=True,
            has_touch=True,
        )
        page = context.new_page()
        page.set_default_timeout(30000)

        try:
            # Test 1: Homepage
            print("\n1. Testing Homepage...")
            page.goto("https://monkeytravel.app", wait_until="networkidle")
            page.wait_for_timeout(1000)
            page.screenshot(path=f"{OUTPUT_DIR}/01_homepage.png", full_page=True)
            print("   Homepage screenshot saved")

            # Test 2: Trip Creation Page
            print("\n2. Testing Trip Creation Page - Step 1 (Destination)...")
            page.goto("https://monkeytravel.app/trips/new", wait_until="networkidle")
            page.wait_for_timeout(1000)
            page.screenshot(path=f"{OUTPUT_DIR}/02_step1_destination.png")
            print("   Step 1 screenshot saved")

            # Select Tokyo destination
            tokyo_btn = page.locator("button:has-text('Tokyo')").first
            if tokyo_btn.is_visible(timeout=5000):
                tokyo_btn.click()
                page.wait_for_timeout(500)

            # Check Continue button
            continue_btn = page.locator("button:has-text('Continue')").first
            if continue_btn.is_visible(timeout=5000) and continue_btn.is_enabled():
                continue_btn.click()
                page.wait_for_timeout(1500)
                page.screenshot(path=f"{OUTPUT_DIR}/03_step2_dates.png")
                print("   Step 2 (Dates) screenshot saved")

                # Fill dates
                date_inputs = page.locator("input[type='date']").all()
                if len(date_inputs) >= 2:
                    date_inputs[0].fill("2025-02-01")
                    date_inputs[1].fill("2025-02-05")
                    page.wait_for_timeout(500)
                    page.screenshot(path=f"{OUTPUT_DIR}/03b_step2_dates_filled.png")
                    print("   Step 2 (Dates filled) screenshot saved")

            # Continue to Step 3
            continue_btn = page.locator("button:has-text('Continue')").first
            if continue_btn.is_visible(timeout=5000) and continue_btn.is_enabled():
                continue_btn.click()
                page.wait_for_timeout(1500)
                page.screenshot(path=f"{OUTPUT_DIR}/04_step3_vibes.png")
                print("   Step 3 (Vibes) screenshot saved")

            # Select some vibes
            vibe_btns = page.locator("button").all()
            selected_vibes = 0
            for btn in vibe_btns:
                try:
                    text = btn.text_content() or ""
                    if any(v in text for v in ["Cultural", "Adventure", "Foodie"]):
                        if btn.is_visible() and btn.is_enabled():
                            btn.click()
                            page.wait_for_timeout(300)
                            selected_vibes += 1
                            if selected_vibes >= 2:
                                break
                except:
                    continue

            page.screenshot(path=f"{OUTPUT_DIR}/04b_step3_vibes_selected.png")
            print("   Step 3 (Vibes selected) screenshot saved")

            # Continue to Step 4
            continue_btn = page.locator("button:has-text('Continue')").first
            if continue_btn.is_visible(timeout=5000) and continue_btn.is_enabled():
                continue_btn.click()
                page.wait_for_timeout(1500)
                page.screenshot(path=f"{OUTPUT_DIR}/05_step4_final.png")
                print("   Step 4 (Final details) screenshot saved")

                # Scroll to see budget options
                page.evaluate("window.scrollBy(0, 300)")
                page.wait_for_timeout(500)
                page.screenshot(path=f"{OUTPUT_DIR}/05b_step4_scrolled.png")
                print("   Step 4 (Scrolled) screenshot saved")

            # Test 3: Trigger Onboarding Modal
            print("\n3. Testing Onboarding Modal...")
            page.evaluate("localStorage.clear()")
            page.wait_for_timeout(500)

            generate_btn = page.locator("button:has-text('Generate')").first
            if generate_btn.is_visible(timeout=5000):
                generate_btn.click()
                page.wait_for_timeout(2000)

                # Check for Onboarding Modal
                onboarding_visible = page.locator("text=Personalize Your Trip").is_visible(timeout=3000)
                if onboarding_visible:
                    page.screenshot(path=f"{OUTPUT_DIR}/06_onboarding_step1.png")
                    print("   Onboarding Step 1 (Travel Style) screenshot saved")

                    # Select travel style
                    adventure_btn = page.locator("button:has-text('Adventure')").first
                    if adventure_btn.is_visible(timeout=2000):
                        adventure_btn.click()
                        page.wait_for_timeout(500)

                    # Click Next
                    next_btn = page.locator("button:has-text('Next')").first
                    if next_btn.is_visible(timeout=2000):
                        next_btn.click()
                        page.wait_for_timeout(1000)
                        page.screenshot(path=f"{OUTPUT_DIR}/07_onboarding_step2.png")
                        print("   Onboarding Step 2 (Dietary) screenshot saved")

                        next_btn = page.locator("button:has-text('Next')").first
                        if next_btn.is_visible(timeout=2000):
                            next_btn.click()
                            page.wait_for_timeout(1000)
                            page.screenshot(path=f"{OUTPUT_DIR}/08_onboarding_step3.png")
                            print("   Onboarding Step 3 (Accessibility) screenshot saved")

                            next_btn = page.locator("button:has-text('Next')").first
                            if next_btn.is_visible(timeout=2000):
                                next_btn.click()
                                page.wait_for_timeout(1000)
                                page.screenshot(path=f"{OUTPUT_DIR}/09_onboarding_step4.png")
                                print("   Onboarding Step 4 (Active Hours) screenshot saved")

                                # Click Create Account
                                create_btn = page.locator("button:has-text('Create Account')").first
                                if create_btn.is_visible(timeout=2000):
                                    create_btn.click()
                                    page.wait_for_timeout(1500)
                                    page.screenshot(path=f"{OUTPUT_DIR}/10_auth_modal.png")
                                    print("   Auth Modal screenshot saved")
                else:
                    # Check for Auth Modal directly
                    auth_visible = page.locator("text=Create Your Account").is_visible(timeout=2000)
                    if auth_visible:
                        page.screenshot(path=f"{OUTPUT_DIR}/06_auth_modal_direct.png")
                        print("   Auth Modal (direct) screenshot saved")
                    else:
                        page.screenshot(path=f"{OUTPUT_DIR}/06_post_generate.png")
                        print("   Post-generate state screenshot saved")

            # Test 4: Login page
            print("\n4. Testing Login Page...")
            page.goto("https://monkeytravel.app/auth/login", wait_until="networkidle")
            page.wait_for_timeout(1000)
            page.screenshot(path=f"{OUTPUT_DIR}/11_login_page.png")
            print("   Login page screenshot saved")

            # Test 5: Signup page
            print("\n5. Testing Signup Page...")
            page.goto("https://monkeytravel.app/auth/signup", wait_until="networkidle")
            page.wait_for_timeout(1000)
            page.screenshot(path=f"{OUTPUT_DIR}/12_signup_page.png")
            print("   Signup page screenshot saved")

            print("\n" + "="*60)
            print("MOBILE UI TEST COMPLETE!")
            print("="*60)
            print(f"\nScreenshots saved to: {OUTPUT_DIR}")

            # List all screenshots
            screenshots = sorted(os.listdir(OUTPUT_DIR))
            print(f"\nGenerated {len(screenshots)} screenshots:")
            for s in screenshots:
                size = os.path.getsize(f"{OUTPUT_DIR}/{s}") // 1024
                print(f"  - {s} ({size}KB)")

        except Exception as e:
            print(f"\nError: {e}")
            page.screenshot(path=f"{OUTPUT_DIR}/error_state.png")
            raise
        finally:
            browser.close()

if __name__ == "__main__":
    main()
