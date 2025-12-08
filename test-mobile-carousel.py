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

    # Test landing page carousel
    print("Testing landing page...")
    page.goto('http://localhost:3000')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(2000)  # Wait for animations

    # Scroll to Curated Escapes section
    page.evaluate('''
        const section = document.querySelector('section:has(.text-xl.font-bold)');
        if (section) section.scrollIntoView({ behavior: 'instant', block: 'start' });
    ''')
    page.wait_for_timeout(1000)

    # Take screenshot of the carousel section
    page.screenshot(path='/tmp/mobile-carousel-landing.png', full_page=False)
    print("Screenshot saved: /tmp/mobile-carousel-landing.png")

    # Test templates page
    print("Testing templates page...")
    page.goto('http://localhost:3000/templates')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(2000)

    page.screenshot(path='/tmp/mobile-templates-page.png', full_page=True)
    print("Screenshot saved: /tmp/mobile-templates-page.png")

    # Get the current carousel indicator styles
    indicator_info = page.evaluate('''
        () => {
            const dots = document.querySelectorAll('.flex.justify-center.gap-1\\.5 button');
            if (dots.length > 0) {
                const dot = dots[0];
                const styles = window.getComputedStyle(dot);
                return {
                    count: dots.length,
                    width: styles.width,
                    height: styles.height,
                    margin: styles.margin,
                    padding: styles.padding,
                    parentHeight: dot.parentElement.offsetHeight,
                    containerClasses: dot.parentElement.className
                };
            }
            return null;
        }
    ''')
    print(f"Indicator info: {indicator_info}")

    browser.close()
    print("Done!")
