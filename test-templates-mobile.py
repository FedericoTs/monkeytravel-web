from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)

    # Mobile viewport (iPhone 14 Pro dimensions)
    context = browser.new_context(
        viewport={'width': 393, 'height': 852},
        device_scale_factor=3,
        is_mobile=True,
        has_touch=True
    )
    page = context.new_page()

    # Test the templates page with shareable URL
    print("Testing templates page on mobile...")
    page.goto('https://monkeytravel.app/templates?_vercel_share=12emwRqM9q2g7z4NW7fTryw6VsN0Gz7Z', timeout=60000)
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(4000)  # Wait for animations and data to load

    # Screenshot of the top of the page
    page.screenshot(path='/tmp/templates-mobile-top.png', full_page=False)
    print("Screenshot saved: /tmp/templates-mobile-top.png")

    # Scroll down to see more cards
    page.evaluate('window.scrollBy(0, 500)')
    page.wait_for_timeout(500)
    page.screenshot(path='/tmp/templates-mobile-cards.png', full_page=False)
    print("Screenshot saved: /tmp/templates-mobile-cards.png")

    # Scroll down more to see the grid
    page.evaluate('window.scrollBy(0, 500)')
    page.wait_for_timeout(500)
    page.screenshot(path='/tmp/templates-mobile-grid.png', full_page=False)
    print("Screenshot saved: /tmp/templates-mobile-grid.png")

    # Take a full page screenshot
    page.screenshot(path='/tmp/templates-mobile-full.png', full_page=True)
    print("Full page screenshot saved: /tmp/templates-mobile-full.png")

    browser.close()
    print("Done!")
