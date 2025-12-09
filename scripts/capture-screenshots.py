#!/usr/bin/env python3
"""
Capture app screenshots for landing page phone mockups.
Screenshots are saved to public/screenshots/ directory.
"""

from playwright.sync_api import sync_playwright
import time

# Output directory
OUTPUT_DIR = "/mnt/c/Users/Samsung/Documents/Projects/travel-app-web/public/screenshots"

# Shared trip tokens for public access
SHARED_TRIPS = {
    "barcelona": "0aca1cce-3fde-4415-b10f-e2b898df3200",
    "porto": "1b867d78-766e-408f-ac5b-cff9600da54f",
    "lisbon": "309484df-3205-464a-9e92-2ee226143c4b",
    "napoli": "4d363af6-2b68-4d75-8ef3-74db70eec3e3",
}

def capture_screenshots():
    with sync_playwright() as p:
        # Launch browser with iPhone 14 Pro viewport (for realistic phone mockups)
        browser = p.chromium.launch(headless=True)

        # iPhone 14 Pro dimensions: 393 x 852 (actual render: 1179 x 2556 with 3x scale)
        context = browser.new_context(
            viewport={"width": 393, "height": 852},
            device_scale_factor=3,  # Retina display
            is_mobile=True,
            has_touch=True
        )
        page = context.new_page()

        # 1. Capture landing page hero section
        print("1. Capturing landing page...")
        page.goto("http://localhost:3000")
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(1000)  # Extra wait for animations
        page.screenshot(path=f"{OUTPUT_DIR}/landing-hero.png", full_page=False)
        print("   Saved: landing-hero.png")

        # 2. Capture shared Barcelona trip - full page with itinerary
        print("2. Capturing Barcelona trip (hero)...")
        page.goto(f"http://localhost:3000/shared/{SHARED_TRIPS['barcelona']}")
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(2000)  # Wait for images and animations
        page.screenshot(path=f"{OUTPUT_DIR}/trip-barcelona-hero.png", full_page=False)
        print("   Saved: trip-barcelona-hero.png")

        # Scroll to itinerary section and capture
        print("3. Capturing Barcelona trip (itinerary)...")
        page.evaluate("window.scrollTo(0, 800)")
        page.wait_for_timeout(500)
        page.screenshot(path=f"{OUTPUT_DIR}/trip-barcelona-itinerary.png", full_page=False)
        print("   Saved: trip-barcelona-itinerary.png")

        # Scroll more to see activities
        print("4. Capturing Barcelona trip (activities)...")
        page.evaluate("window.scrollTo(0, 1500)")
        page.wait_for_timeout(500)
        page.screenshot(path=f"{OUTPUT_DIR}/trip-barcelona-activities.png", full_page=False)
        print("   Saved: trip-barcelona-activities.png")

        # 3. Capture Porto trip
        print("5. Capturing Porto trip...")
        page.goto(f"http://localhost:3000/shared/{SHARED_TRIPS['porto']}")
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(2000)
        page.screenshot(path=f"{OUTPUT_DIR}/trip-porto-hero.png", full_page=False)
        print("   Saved: trip-porto-hero.png")

        # 4. Capture Lisbon trip
        print("6. Capturing Lisbon trip...")
        page.goto(f"http://localhost:3000/shared/{SHARED_TRIPS['lisbon']}")
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(2000)
        page.screenshot(path=f"{OUTPUT_DIR}/trip-lisbon-hero.png", full_page=False)
        print("   Saved: trip-lisbon-hero.png")

        # 5. Capture templates page
        print("7. Capturing templates page...")
        page.goto("http://localhost:3000/templates")
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(1000)
        page.screenshot(path=f"{OUTPUT_DIR}/templates.png", full_page=False)
        print("   Saved: templates.png")

        browser.close()
        print("\nDone! Screenshots saved to public/screenshots/")
        print("\nRecommended usage:")
        print("  hero: trip-barcelona-hero.png or trip-porto-hero.png")
        print("  preview.left: trip-lisbon-hero.png")
        print("  preview.center: trip-barcelona-itinerary.png")
        print("  preview.right: trip-barcelona-activities.png")

if __name__ == "__main__":
    capture_screenshots()
