const puppeteer = require('puppeteer');

(async () => {
  console.log('Starting test...');
  const browser = await puppeteer.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  
  const url = 'https://www.cjdropshipping.com/search/fleece+throw+blanket.html?pageNum=1&verifiedWarehouse=1';
  console.log('Loading:', url);
  
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  console.log('✅ Page loaded');
  
  console.log('Waiting 5s for Vue...');
  await page.waitForTimeout(5000);
  
  console.log('Scrolling...');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
  await page.waitForTimeout(2000);
  
  // Check what selectors exist
  const selectorTests = await page.evaluate(() => {
    return {
      'data-product-type': document.querySelectorAll('[data-product-type]').length,
      'data-product-id': document.querySelectorAll('[data-product-id]').length,
      '.product-row': document.querySelectorAll('.product-row').length,
      '.product-row[data-product-id]': document.querySelectorAll('.product-row[data-product-id]').length,
      '.product-title': document.querySelectorAll('.product-title').length,
      '.product-title with text': Array.from(document.querySelectorAll('.product-title')).filter(el => el.textContent.trim().length > 0).length
    };
  });
  
  console.log('\nSelector counts:', JSON.stringify(selectorTests, null, 2));
  
  // Get sample product HTML
  const sampleHTML = await page.evaluate(() => {
    const row = document.querySelector('.product-row');
    if (row) {
      return {
        outerHTML: row.outerHTML.substring(0, 1000),
        textContent: row.textContent.substring(0, 500),
        titleHTML: row.querySelector('.product-title')?.outerHTML || 'none',
        titleText: row.querySelector('.product-title')?.textContent?.trim() || 'empty'
      };
    }
    return null;
  });
  
  console.log('\nSample product:', JSON.stringify(sampleHTML, null, 2));
  
  // Try to extract products with current method
  const products = await page.evaluate(() => {
    const items = [];
    const productElements = document.querySelectorAll('.product-row[data-product-id]');
    productElements.forEach(el => {
      const title = el.querySelector('.product-title')?.textContent?.trim() || 
                   el.querySelector('h4')?.textContent?.trim() ||
                   el.querySelector('[class*="title"]')?.textContent?.trim() || '';
      const link = el.querySelector('a');
      const href = link?.getAttribute('href') || '';
      items.push({ title, href });
    });
    return items;
  });
  
  console.log('\nExtracted products:', products.length);
  if (products.length > 0) {
    console.log('First 3:', JSON.stringify(products.slice(0, 3), null, 2));
  }
  
  await browser.close();
  console.log('\n✅ Test complete');
})();
