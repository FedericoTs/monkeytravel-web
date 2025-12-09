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
    print("Testing templates page - featured card...")
    page.goto('https://monkeytravel.app/templates?_vercel_share=CoXvwpkYqU8yVDpfnsQraR4WsT08aYNJ', timeout=60000)
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(5000)  # Wait for animations and data to load

    # Screenshot of the header area
    page.screenshot(path='/tmp/featured-card-top.png', full_page=False)
    print("Screenshot saved: /tmp/featured-card-top.png")

    # Scroll past the header to see featured card better
    page.evaluate('window.scrollTo(0, 120)')
    page.wait_for_timeout(500)
    page.screenshot(path='/tmp/featured-card-scrolled.png', full_page=False)
    print("Screenshot saved: /tmp/featured-card-scrolled.png")

    # Get full page
    page.screenshot(path='/tmp/featured-card-full.png', full_page=True)
    print("Full page screenshot saved: /tmp/featured-card-full.png")

    # Also test on a slightly larger mobile (iPhone Plus size)
    context2 = browser.new_context(
        viewport={'width': 428, 'height': 926},
        device_scale_factor=3,
        is_mobile=True,
        has_touch=True
    )
    page2 = context2.new_page()
    page2.goto('https://monkeytravel.app/templates?_vercel_share=CoXvwpkYqU8yVDpfnsQraR4WsT08aYNJ', timeout=60000)
    page2.wait_for_load_state('networkidle')
    page2.wait_for_timeout(4000)
    page2.screenshot(path='/tmp/featured-card-large-mobile.png', full_page=False)
    print("Large mobile screenshot saved: /tmp/featured-card-large-mobile.png")

    browser.close()
    print("Done!")
