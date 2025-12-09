#!/usr/bin/env python3
"""Verify landing page with fresh browser context."""

from playwright.sync_api import sync_playwright

OUTPUT_DIR = "/mnt/c/Users/Samsung/Documents/Projects/travel-app-web/public/screenshots"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)

    # Fresh context with no caching
    context = browser.new_context(
        viewport={"width": 1440, "height": 900},
        device_scale_factor=2,
        bypass_csp=True
    )
    page = context.new_page()

    print("Capturing fresh landing page...")
    # Hard refresh
    page.goto("http://localhost:3000", wait_until="networkidle")
    page.reload(wait_until="networkidle")
    page.wait_for_timeout(3000)  # Wait for images to load

    # Check for image errors
    errors = page.evaluate("""() => {
        const imgs = document.querySelectorAll('img');
        const errors = [];
        imgs.forEach(img => {
            if (!img.complete || img.naturalHeight === 0) {
                errors.push(img.src);
            }
        });
        return errors;
    }""")
    print(f"Image load errors: {errors}")

    page.screenshot(path=f"{OUTPUT_DIR}/landing-fresh.png", full_page=False)
    print("  Saved: landing-fresh.png")

    # Scroll to app preview section (phones)
    print("Looking for phone preview section...")
    page.evaluate("window.scrollTo(0, 3500)")
    page.wait_for_timeout(1000)
    page.screenshot(path=f"{OUTPUT_DIR}/landing-phones-section.png", full_page=False)
    print("  Saved: landing-phones-section.png")

    browser.close()
    print("\nDone!")
