import { chromium } from 'playwright';

async function testDistances() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Capture network requests to the distance API
  const distanceRequests = [];
  const distanceResponses = [];

  page.on('request', request => {
    if (request.url().includes('/api/travel/distance')) {
      console.log('\n=== DISTANCE API REQUEST ===');
      console.log('URL:', request.url());
      console.log('Method:', request.method());
      try {
        const body = JSON.parse(request.postData() || '{}');
        console.log('Pairs count:', body.pairs?.length);
        console.log('First 3 pairs:', JSON.stringify(body.pairs?.slice(0, 3), null, 2));
      } catch (e) {
        console.log('Request body:', request.postData());
      }
      distanceRequests.push(request);
    }
  });

  page.on('response', async response => {
    if (response.url().includes('/api/travel/distance')) {
      console.log('\n=== DISTANCE API RESPONSE ===');
      console.log('Status:', response.status());
      try {
        const data = await response.json();
        console.log('Stats:', JSON.stringify(data.stats, null, 2));
        console.log('Results count:', data.results?.length);
        console.log('Modes in results:', [...new Set(data.results?.map(r => r.mode))]);
        console.log('First 3 results:', JSON.stringify(data.results?.slice(0, 3), null, 2));
        distanceResponses.push(data);
      } catch (e) {
        console.log('Could not parse response:', e.message);
      }
    }
  });

  // Capture console logs
  page.on('console', msg => {
    if (msg.text().includes('distance') || msg.text().includes('Distance') || msg.text().includes('travel')) {
      console.log('CONSOLE:', msg.type(), msg.text());
    }
  });

  console.log('Navigating to trip page...');
  await page.goto('https://www.monkeytravel.app/trips/db661993-596d-4070-8d2b-ac6793b30e41', {
    waitUntil: 'networkidle',
    timeout: 60000
  });

  // Wait for any remaining requests
  await page.waitForTimeout(5000);

  // Check what travel connectors are visible
  const connectors = await page.evaluate(() => {
    const elements = document.querySelectorAll('[class*="TravelConnector"], [class*="travel"], .flex.items-center.justify-center.py-3');
    return Array.from(elements).map(el => ({
      classes: el.className,
      text: el.textContent?.trim().substring(0, 100),
      hasCarIcon: el.querySelector('svg')?.innerHTML?.includes('Car') || false,
      hasBusIcon: el.querySelector('svg')?.innerHTML?.includes('Bus') || false,
      hasWalkIcon: el.querySelector('svg')?.innerHTML?.includes('Footprints') || el.querySelector('svg')?.innerHTML?.includes('foot') || false
    }));
  });

  console.log('\n=== TRAVEL CONNECTORS ON PAGE ===');
  console.log('Found', connectors.length, 'potential connector elements');
  connectors.forEach((c, i) => console.log(`Connector ${i}:`, JSON.stringify(c)));

  // Look for specific travel pill elements (the colored badges)
  const pills = await page.$$eval('.rounded-full', elements => {
    return elements
      .filter(el => el.textContent?.includes('min') || el.textContent?.includes('km') || el.textContent?.includes('mi'))
      .map(el => ({
        text: el.textContent?.trim(),
        classes: el.className,
        bgColor: window.getComputedStyle(el).backgroundColor
      }));
  });

  console.log('\n=== TRAVEL PILLS (badges with time/distance) ===');
  console.log('Found', pills.length, 'travel pills');
  pills.forEach((p, i) => console.log(`Pill ${i}:`, JSON.stringify(p)));

  // Take a screenshot
  await page.screenshot({ path: '/tmp/trip-page.png', fullPage: true });
  console.log('\nScreenshot saved to /tmp/trip-page.png');

  await browser.close();

  // Summary
  console.log('\n=== SUMMARY ===');
  console.log('Distance requests made:', distanceRequests.length);
  console.log('Responses received:', distanceResponses.length);
  if (distanceResponses.length > 0) {
    const allModes = distanceResponses.flatMap(r => r.results?.map(res => res.mode) || []);
    console.log('All modes in responses:', [...new Set(allModes)]);
    console.log('Driving results:', allModes.filter(m => m === 'DRIVING').length);
    console.log('Walking results:', allModes.filter(m => m === 'WALKING').length);
    console.log('Transit results:', allModes.filter(m => m === 'TRANSIT').length);
  }
}

testDistances().catch(console.error);
