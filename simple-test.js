// Ultra-simple test to see if CJ blocks Puppeteer
const puppeteer = require('puppeteer');

(async () => {
  console.log('Starting browser...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  
  console.log('Loading CJ search page...');
  const url = 'https://www.cjdropshipping.com/search/blanket.html';
  
  try {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    console.log('Status:', response.status());
    console.log('✅ Page loaded');
    
    // Wait a bit
    await page.waitForTimeout(5000);
    
    // Check what's on the page
    const pageInfo = await page.evaluate(() => {
      return {
        title: document.title,
        bodyLength: document.body.innerHTML.length,
        hasProductRow: document.querySelectorAll('.product-row').length,
        bodyPreview: document.body.textContent.substring(0, 500)
      };
    });
    
    console.log('\nPage info:', JSON.stringify(pageInfo, null, 2));
    
    // Take screenshot
    await page.screenshot({ path: '/Users/rhysmckay/clawd/cj-scraper/test-screenshot.png', fullPage: false });
    console.log('Screenshot saved to test-screenshot.png');
    
  } catch (err) {
    console.error('❌ ERROR:', err.message);
  }
  
  await browser.close();
})();
