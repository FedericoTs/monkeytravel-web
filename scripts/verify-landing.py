#!/usr/bin/env python3
"""Verify landing page screenshots are working."""

from playwright.sync_api import sync_playwright

OUTPUT_DIR = "/mnt/c/Users/Samsung/Documents/Projects/travel-app-web/public/screenshots"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)

    # Desktop view to see phone mockups
    context = browser.new_context(
        viewport={"width": 1440, "height": 900},
        device_scale_factor=2
    )
    page = context.new_page()

    print("Capturing landing page with screenshots...")
    page.goto("http://localhost:3000")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(2000)
    page.screenshot(path=f"{OUTPUT_DIR}/landing-desktop-verify.png", full_page=False)
    print("  Saved: landing-desktop-verify.png")

    # Scroll to preview section
    print("Capturing preview section...")
    page.evaluate("window.scrollTo(0, 2500)")
    page.wait_for_timeout(1000)
    page.screenshot(path=f"{OUTPUT_DIR}/landing-preview-section.png", full_page=False)
    print("  Saved: landing-preview-section.png")

    browser.close()
    print("\nDone!")
