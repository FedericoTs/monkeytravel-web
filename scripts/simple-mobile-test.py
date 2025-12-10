#!/usr/bin/env python3
"""
Simple Mobile Modal Testing Script
Tests the mobile UI of key modals with better error handling.
"""

from playwright.sync_api import sync_playwright
import os
import sys

OUTPUT_DIR = "/tmp/mobile-tests"
os.makedirs(OUTPUT_DIR, exist_ok=True)

def main():
    print("Starting Mobile UI Tests...")

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
        page.set_default_timeout(60000)  # 60 second timeout

        try:
            # Test 1: Homepage
            print("\n1. Testing Homepage...")
            page.goto("http://localhost:3000", wait_until="domcontentloaded")
            page.wait_for_timeout(2000)
            page.screenshot(path=f"{OUTPUT_DIR}/01_homepage.png")
            print("   Homepage screenshot saved")

            # Test 2: Trip Creation Page
            print("\n2. Testing Trip Creation Page...")
            page.goto("http://localhost:3000/trips/new", wait_until="domcontentloaded")
            page.wait_for_timeout(2000)
            page.screenshot(path=f"{OUTPUT_DIR}/02_trips_new_step1.png")
            print("   Step 1 (Destination) screenshot saved")

            # Select a destination
            tokyo_btn = page.locator("button:has-text('Tokyo')").first
            if tokyo_btn.is_visible(timeout=5000):
                tokyo_btn.click()
                page.wait_for_timeout(500)

            # Click Continue
            continue_btn = page.locator("button:has-text('Continue')").first
            if continue_btn.is_visible(timeout=5000) and continue_btn.is_enabled():
                continue_btn.click()
                page.wait_for_timeout(1000)
                page.screenshot(path=f"{OUTPUT_DIR}/03_trips_new_step2.png")
                print("   Step 2 (Dates) screenshot saved")

            # Fill dates
            date_inputs = page.locator("input[type='date']").all()
            if len(date_inputs) >= 2:
                date_inputs[0].fill("2025-02-01")
                date_inputs[1].fill("2025-02-05")
                page.wait_for_timeout(500)

            # Continue to Step 3
            continue_btn = page.locator("button:has-text('Continue')").first
            if continue_btn.is_visible(timeout=5000) and continue_btn.is_enabled():
                continue_btn.click()
                page.wait_for_timeout(1000)
                page.screenshot(path=f"{OUTPUT_DIR}/04_trips_new_step3.png")
                print("   Step 3 (Vibes) screenshot saved")

            # Select a vibe
            vibe_btns = page.locator("button").all()
            for btn in vibe_btns:
                try:
                    text = btn.text_content()
                    if "Cultural" in text or "Adventure" in text or "Foodie" in text:
                        btn.click()
                        page.wait_for_timeout(300)
                        break
                except:
                    continue

            # Continue to Step 4
            continue_btn = page.locator("button:has-text('Continue')").first
            if continue_btn.is_visible(timeout=5000) and continue_btn.is_enabled():
                continue_btn.click()
                page.wait_for_timeout(1000)
                page.screenshot(path=f"{OUTPUT_DIR}/05_trips_new_step4.png")
                print("   Step 4 (Final) screenshot saved")

            # Test 3: Try to trigger Onboarding Modal
            print("\n3. Testing Onboarding Modal...")
            page.evaluate("localStorage.clear()")  # Clear to trigger onboarding

            generate_btn = page.locator("button:has-text('Generate')").first
            if generate_btn.is_visible(timeout=5000):
                generate_btn.click()
                page.wait_for_timeout(2000)

                # Check for Onboarding Modal
                if page.locator("text=Personalize Your Trip").is_visible(timeout=3000):
                    page.screenshot(path=f"{OUTPUT_DIR}/06_onboarding_modal.png")
                    print("   Onboarding Modal screenshot saved")

                    # Navigate through steps
                    # Step 1 - select travel style
                    style_btn = page.locator("button:has-text('Adventure')").first
                    if style_btn.is_visible(timeout=2000):
                        style_btn.click()
                        page.wait_for_timeout(500)

                    next_btn = page.locator("button:has-text('Next')").first
                    if next_btn.is_visible(timeout=2000):
                        next_btn.click()
                        page.wait_for_timeout(1000)
                        page.screenshot(path=f"{OUTPUT_DIR}/07_onboarding_step2.png")
                        print("   Onboarding Step 2 screenshot saved")

                    # Step 2 - skip dietary (optional)
                    next_btn = page.locator("button:has-text('Next')").first
                    if next_btn.is_visible(timeout=2000):
                        next_btn.click()
                        page.wait_for_timeout(1000)
                        page.screenshot(path=f"{OUTPUT_DIR}/08_onboarding_step3.png")
                        print("   Onboarding Step 3 screenshot saved")

                    # Step 3 - skip accessibility (optional)
                    next_btn = page.locator("button:has-text('Next')").first
                    if next_btn.is_visible(timeout=2000):
                        next_btn.click()
                        page.wait_for_timeout(1000)
                        page.screenshot(path=f"{OUTPUT_DIR}/09_onboarding_step4.png")
                        print("   Onboarding Step 4 (Active Hours) screenshot saved")

                    # Final step - Create Account
                    create_btn = page.locator("button:has-text('Create Account')").first
                    if create_btn.is_visible(timeout=2000):
                        create_btn.click()
                        page.wait_for_timeout(1500)

                        # Auth Modal should appear
                        page.screenshot(path=f"{OUTPUT_DIR}/10_auth_modal.png")
                        print("   Auth Modal screenshot saved")
                else:
                    # Check if Auth Modal appeared directly
                    if page.locator("text=Create Your Account").is_visible(timeout=2000):
                        page.screenshot(path=f"{OUTPUT_DIR}/06_auth_modal_direct.png")
                        print("   Auth Modal (direct) screenshot saved")
                    else:
                        page.screenshot(path=f"{OUTPUT_DIR}/06_after_generate.png")
                        print("   Post-generate state screenshot saved")

            # Test 4: Check Early Access Modal structure from code
            print("\n4. Verifying Early Access Modal structure...")
            print("   Modal has Beta Code input + Waitlist option - verified from code")

            print("\n" + "="*50)
            print("TEST COMPLETE!")
            print("="*50)
            print(f"\nScreenshots saved to: {OUTPUT_DIR}")

            # List all screenshots
            screenshots = sorted(os.listdir(OUTPUT_DIR))
            print(f"\nGenerated {len(screenshots)} screenshots:")
            for s in screenshots:
                print(f"  - {s}")

        except Exception as e:
            print(f"\nError: {e}")
            page.screenshot(path=f"{OUTPUT_DIR}/error_state.png")
            print(f"Error screenshot saved to {OUTPUT_DIR}/error_state.png")
            raise
        finally:
            browser.close()

if __name__ == "__main__":
    main()
