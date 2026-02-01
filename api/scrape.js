// Vercel Serverless Function for CJ Scraping
const puppeteer = require('puppeteer-core');
const chrome = require('@sparticuz/chromium');

// AI-powered product relevance checker
function isRelevantProduct(productTitle, searchTerm) {
  const lowerTitle = productTitle.toLowerCase();
  const lowerSearch = searchTerm.toLowerCase();

  // Extract key words from search term
  const searchWords = lowerSearch.split(' ').filter(w => w.length > 2);

  // Must contain primary search term
  const primaryMatch = searchWords.some(word => lowerTitle.includes(word));
  if (!primaryMatch) return false;

  // Detect false positives
  const falsePositives = [
    'summer blanket', 'air conditioning blanket', 'cooling blanket',
    'beach mat', 'pet blanket', 'dog blanket', 'cat blanket',
    'knitted blanket', 'cotton blanket', 'gauze', 'towel quilt',
    'children', 'infant', 'baby', 'mat', 'quilt'
  ];

  // For "sherpa blanket" search
  if (lowerSearch.includes('sherpa')) {
    // Must explicitly mention sherpa
    if (!lowerTitle.includes('sherpa')) return false;

    // Reject if it's a pet-only product without sherpa mention
    if (lowerTitle.includes('pet') && !lowerTitle.includes('sherpa')) return false;
  }

  // Check for false positive patterns
  for (const falsePos of falsePositives) {
    if (lowerTitle.includes(falsePos) && !lowerTitle.includes(lowerSearch)) {
      return false;
    }
  }

  return true;
}

// Scrape CJDropshipping
async function scrapeCJDropshipping(searchTerm, options = {}) {
  let browser = null;

  try {
    browser = await puppeteer.launch({
      args: chrome.args,
      defaultViewport: chrome.defaultViewport,
      executablePath: await chrome.executablePath(),
      headless: chrome.headless,
    });

    const page = await browser.newPage();

    // Build URL
    const baseUrl = 'https://www.cjdropshipping.com/search/';
    const encodedTerm = encodeURIComponent(searchTerm);
    let url = `${baseUrl}${encodedTerm}.html?pageNum=1`;

    // Add filters if specified
    if (options.verifiedWarehouse) {
      url += '&verifiedWarehouse=1';
    }
    if (options.minInventory) {
      url += `&startWarehouseInventory=${options.minInventory}`;
    }

    console.log(`Scraping: ${url}`);

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    // Wait for products to load
    await page.waitForSelector('[data-product-type]', { timeout: 10000 }).catch(() => { });

    // Extract product data
    const products = await page.evaluate(() => {
      const items = [];
      const productElements = document.querySelectorAll('[data-product-type]');

      productElements.forEach(el => {
        try {
          const link = el.querySelector('a');
          const title = el.querySelector('[class*="title"]')?.textContent?.trim() ||
            link?.textContent?.trim()?.split('\n')[0] || '';
          const priceEl = el.querySelector('[class*="price"]');
          const price = priceEl?.textContent?.trim() || '';
          const href = link?.getAttribute('href') || '';
          const lists = el.textContent.match(/Lists?:\s*(\d+)/i)?.[1] || '0';

          if (title && href) {
            items.push({
              title,
              price,
              lists: parseInt(lists),
              url: href.startsWith('http') ? href : `https://www.cjdropshipping.com${href}`
            });
          }
        } catch (err) {
          console.error('Parse error:', err);
        }
      });

      return items;
    });

    console.log(`Found ${products.length} products before filtering`);

    // Filter relevant products
    const filtered = products.filter(p => isRelevantProduct(p.title, searchTerm));

    console.log(`${filtered.length} products passed filter (${((filtered.length / products.length) * 100).toFixed(1)}%)`);

    return {
      success: true,
      searchTerm,
      totalFound: products.length,
      filtered: filtered.length,
      passRate: ((filtered.length / products.length) * 100).toFixed(1) + '%',
      products: filtered
    };

  } catch (error) {
    console.error('Scraping error:', error);
    return {
      success: false,
      error: error.message
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// Vercel Serverless Function Handler
module.exports = async (req, res) => {
  // ============================================
  // COMPREHENSIVE LOGGING FOR DEBUG
  // ============================================
  const requestId = Date.now().toString(36) + Math.random().toString(36).substr(2);

  console.log('='.repeat(60));
  console.log(`[${requestId}] INCOMING REQUEST AT ${new Date().toISOString()}`);
  console.log(`[${requestId}] Method: ${req.method}`);
  console.log(`[${requestId}] URL: ${req.url}`);
  console.log(`[${requestId}] Headers:`, JSON.stringify(req.headers, null, 2));
  console.log(`[${requestId}] Body:`, JSON.stringify(req.body, null, 2));
  console.log('='.repeat(60));

  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    console.log(`[${requestId}] Handling OPTIONS preflight request`);
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    console.error(`[${requestId}] ERROR: Method ${req.method} not allowed. Only POST is accepted.`);
    return res.status(405).json({
      error: 'Method not allowed',
      receivedMethod: req.method,
      expectedMethod: 'POST',
      requestId
    });
  }

  const { searchTerm, options } = req.body || {};

  console.log(`[${requestId}] Parsed searchTerm: "${searchTerm}"`);
  console.log(`[${requestId}] Parsed options:`, JSON.stringify(options, null, 2));

  if (!searchTerm) {
    console.error(`[${requestId}] ERROR: searchTerm is missing from request body`);
    return res.status(400).json({
      error: 'searchTerm is required',
      receivedBody: req.body,
      requestId
    });
  }

  try {
    console.log(`[${requestId}] Starting scrape for: "${searchTerm}"`);
    const startTime = Date.now();

    const results = await scrapeCJDropshipping(searchTerm, options || {});

    const duration = Date.now() - startTime;
    console.log(`[${requestId}] Scrape completed in ${duration}ms`);
    console.log(`[${requestId}] Results: ${results.success ? 'SUCCESS' : 'FAILED'}, Products: ${results.filtered || 0}`);

    res.status(200).json({
      ...results,
      requestId,
      processingTime: `${duration}ms`
    });
  } catch (error) {
    console.error(`[${requestId}] FATAL ERROR:`, error.message);
    console.error(`[${requestId}] Stack:`, error.stack);
    res.status(500).json({
      error: error.message,
      requestId,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};
