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

    # Test deployment preview URL
    print("Testing deployment preview...")
    page.goto('https://travel-app-cv2yeupql-federicosciuca-gmailcoms-projects.vercel.app', timeout=60000)
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(3000)  # Wait for animations

    # Scroll to Curated Escapes section
    page.evaluate('''
        const headers = document.querySelectorAll('h2');
        for (const h of headers) {
            if (h.textContent.includes('Curated Escapes')) {
                h.scrollIntoView({ behavior: 'instant', block: 'start' });
                break;
            }
        }
    ''')
    page.wait_for_timeout(1500)

    # Take screenshot of the carousel section
    page.screenshot(path='/tmp/mobile-carousel-preview.png', full_page=False)
    print("Screenshot saved: /tmp/mobile-carousel-preview.png")

    # Also take a full page screenshot
    page.screenshot(path='/tmp/mobile-full-preview.png', full_page=True)
    print("Full page screenshot saved: /tmp/mobile-full-preview.png")

    browser.close()
    print("Done!")
