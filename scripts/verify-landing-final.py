#!/usr/bin/env python3
"""Verify landing page screenshots."""

from playwright.sync_api import sync_playwright

OUTPUT_DIR = "/mnt/c/Users/Samsung/Documents/Projects/travel-app-web/public/screenshots"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)

    context = browser.new_context(
        viewport={"width": 1440, "height": 900},
        device_scale_factor=2
    )
    page = context.new_page()

    print("Loading landing page...")
    page.goto("http://localhost:3000", wait_until="networkidle")
    page.wait_for_timeout(5000)

    page.screenshot(path=f"{OUTPUT_DIR}/final-hero.png", full_page=False)
    print("  Saved: final-hero.png")

    # Check image elements
    img_info = page.evaluate("""() => {
        const images = document.querySelectorAll('img');
        return Array.from(images).map(img => ({
            src: img.src.substring(0, 100),
            loaded: img.complete,
            height: img.naturalHeight
        })).slice(0, 15);
    }""")
    print(f"  Images info:")
    for i, img in enumerate(img_info):
        status = "OK" if img['loaded'] and img['height'] > 0 else "FAILED"
        print(f"    {i}: {status} - {img['src'][:60]}...")

    browser.close()
    print("\nDone!")
