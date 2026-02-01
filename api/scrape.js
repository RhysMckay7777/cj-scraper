// Vercel Serverless Function for CJ Scraping  
// Fixed: URL parsing + Strict relevance filter (v1.3 - deployed)
const puppeteer = require('puppeteer-core');
const chrome = require('@sparticuz/chromium');

// STRICT AI-powered product relevance checker
function isRelevantProduct(productTitle, searchTerm) {
  const lowerTitle = productTitle.toLowerCase();
  const lowerSearch = searchTerm.toLowerCase();
  
  // Extract ALL key words from search term (filter short words like "a", "the")
  const searchWords = lowerSearch.split(' ').filter(w => w.length > 2);
  
  // *** CRITICAL FIX: ALL keywords must be present ***
  // For "fleece throw blanket" - title MUST contain "fleece" AND "throw" AND "blanket"
  const allWordsPresent = searchWords.every(word => lowerTitle.includes(word));
  if (!allWordsPresent) {
    return false; // Reject if missing ANY keyword
  }
  
  // Strict category detection - reject non-blanket items
  const invalidCategories = [
    // Clothing
    'hoodie', 'sweatshirt', 'jacket', 'coat', 'sweater', 'shirt', 'pants', 'joggers',
    'pullover', 'cardigan', 'vest', 'shorts', 'leggings', 'dress', 'skirt',
    // Footwear
    'shoes', 'sneakers', 'boots', 'slippers', 'sandals', 'loafers',
    // Pets
    'dog', 'cat', 'pet', 'puppy', 'kitten',
    // Baby/Kids (unless blanket)
    'baby', 'infant', 'toddler', 'kids', 'children',
    // Other home items that aren't blankets
    'pillow', 'cushion', 'mat', 'rug', 'carpet', 'curtain', 'towel',
    // Bedding that's not throws
    'sheet', 'duvet', 'comforter', 'quilt cover',
    // Accessories
    'scarf', 'shawl', 'gloves', 'mittens', 'hat', 'beanie'
  ];
  
  // Check for invalid categories
  for (const invalid of invalidCategories) {
    if (lowerTitle.includes(invalid)) {
      // Exception: if it explicitly says "blanket" after the category, it might be OK
      // e.g., "dog blanket" is OK, but "dog clothes" is not
      const hasBlanketsAfter = lowerTitle.includes(invalid + ' blanket') || 
                               lowerTitle.includes(invalid + ' throw');
      if (!hasBlanketsAfter) {
        return false; // Reject invalid category
      }
    }
  }
  
  // For specific search terms, add extra validation
  if (lowerSearch.includes('throw') && lowerSearch.includes('blanket')) {
    // Must contain both "throw" and "blanket"
    if (!lowerTitle.includes('throw') || !lowerTitle.includes('blanket')) {
      return false;
    }
  }
  
  if (lowerSearch.includes('sherpa')) {
    // Must explicitly mention sherpa
    if (!lowerTitle.includes('sherpa')) return false;
  }
  
  return true; // Passed all checks
}

// Parse CJ URL to extract search term and all filters
function parseCJUrl(url) {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    
    // Extract keyword from /search/KEYWORD.html
    const match = pathname.match(/\/search\/(.+?)\.html/);
    const keyword = match ? decodeURIComponent(match[1]).replace(/\+/g, ' ') : '';
    
    // Extract ALL query parameters as filters
    const params = new URLSearchParams(urlObj.search);
    const filters = {};
    
    // Capture all parameters
    for (const [key, value] of params.entries()) {
      filters[key] = value;
    }
    
    console.log('Parsed CJ URL:', { keyword, filters });
    
    return { keyword, filters };
  } catch (e) {
    console.error('URL parse error:', e);
    return { keyword: '', filters: {} };
  }
}

// Scrape CJDropshipping with proper pagination and URL parsing
async function scrapeCJDropshipping(searchUrl, searchTerm = null) {
  let browser = null;
  const allProducts = [];
  
  try {
    browser = await puppeteer.launch({
      args: chrome.args,
      defaultViewport: chrome.defaultViewport,
      executablePath: await chrome.executablePath(),
      headless: chrome.headless,
    });
    
    const page = await browser.newPage();
    
    // Parse URL if provided, otherwise build from search term
    let baseUrl, keyword, filters;
    
    if (searchUrl && searchUrl.includes('cjdropshipping.com')) {
      // User provided a CJ URL - extract everything from it
      const parsed = parseCJUrl(searchUrl);
      keyword = parsed.keyword;
      filters = parsed.filters;
      
      // Remove pageNum from filters (we'll add it per page)
      delete filters.pageNum;
      
      baseUrl = `https://www.cjdropshipping.com/search/${encodeURIComponent(keyword)}.html`;
    } else {
      // Fallback: build URL from search term
      keyword = searchTerm || searchUrl;
      filters = {};
      baseUrl = `https://www.cjdropshipping.com/search/${encodeURIComponent(keyword)}.html`;
    }
    
    console.log('Scraping config:', { keyword, filters, baseUrl });
    
    let currentPage = 1;
    let hasMorePages = true;
    let totalPages = null;
    
    // Paginate through all results
    while (hasMorePages) {
      // Build URL with page number + all filters
      const queryParams = new URLSearchParams({
        pageNum: currentPage.toString(),
        ...filters
      });
      
      const url = `${baseUrl}?${queryParams.toString()}`;
      
      console.log(`Scraping page ${currentPage}: ${url}`);
      
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      
      // Wait for products to load
      await page.waitForSelector('[data-product-type]', { timeout: 10000 }).catch(() => {});
      
      // Detect total pages (only on first page)
      if (currentPage === 1) {
        totalPages = await page.evaluate(() => {
          // Look for pagination element showing "1 / X" or similar
          const paginationText = document.body.textContent;
          const pageMatch = paginationText.match(/Page\s+\d+\s+of\s+(\d+)/i) ||
                           paginationText.match(/\d+\s*\/\s*(\d+)/);
          
          if (pageMatch) {
            return parseInt(pageMatch[1]);
          }
          
          // Fallback: count pagination buttons
          const paginationButtons = document.querySelectorAll('[class*="pagination"] button, [class*="page"] button');
          if (paginationButtons.length > 0) {
            const numbers = Array.from(paginationButtons)
              .map(btn => parseInt(btn.textContent))
              .filter(n => !isNaN(n));
            return numbers.length > 0 ? Math.max(...numbers) : 1;
          }
          
          return 1; // Default to 1 page
        });
        
        console.log(`Total pages detected: ${totalPages}`);
      }
      
      // Extract products from current page
      const pageProducts = await page.evaluate(() => {
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
            
            // Extract image URL
            const img = el.querySelector('img');
            const imageUrl = img?.getAttribute('src') || img?.getAttribute('data-src') || '';
            
            if (title && href) {
              items.push({
                title,
                price,
                lists: parseInt(lists),
                url: href.startsWith('http') ? href : `https://www.cjdropshipping.com${href}`,
                image: imageUrl
              });
            }
          } catch (err) {
            console.error('Parse error:', err);
          }
        });
        
        return items;
      });
      
      console.log(`Page ${currentPage}: Found ${pageProducts.length} products`);
      
      // Stop if no products found on this page
      if (pageProducts.length === 0) {
        console.log('No products found - stopping pagination');
        hasMorePages = false;
        break;
      }
      
      // Add to total
      allProducts.push(...pageProducts);
      
      // Check if we should continue
      currentPage++;
      if (totalPages && currentPage > totalPages) {
        console.log(`Reached max pages (${totalPages}) - stopping`);
        hasMorePages = false;
      }
      
      // Safety limit: stop at 10 pages max
      if (currentPage > 10) {
        console.log('Safety limit: stopping at page 10');
        hasMorePages = false;
      }
      
      // Small delay between pages
      if (hasMorePages) {
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }
    
    console.log(`Total products scraped: ${allProducts.length} across ${currentPage - 1} pages`);
    
    // Filter relevant products with STRICT checking
    const filtered = allProducts.filter(p => isRelevantProduct(p.title, keyword));
    
    console.log(`${filtered.length} products passed STRICT filter (${((filtered.length/allProducts.length)*100).toFixed(1)}%)`);
    
    // Show rejected examples for debugging
    const rejected = allProducts.filter(p => !isRelevantProduct(p.title, keyword));
    if (rejected.length > 0) {
      console.log('Sample rejected products:');
      rejected.slice(0, 5).forEach(p => console.log(`  ❌ ${p.title}`));
    }
    
    return {
      success: true,
      searchTerm: keyword,
      filters: filters,
      totalFound: allProducts.length,
      filtered: filtered.length,
      passRate: ((filtered.length/allProducts.length)*100).toFixed(1) + '%',
      pagesScraped: currentPage - 1,
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
  const requestId = Date.now().toString(36) + Math.random().toString(36).substr(2);
  
  console.log('='.repeat(60));
  console.log(`[${requestId}] INCOMING REQUEST AT ${new Date().toISOString()}`);
  console.log(`[${requestId}] Method: ${req.method}`);
  console.log(`[${requestId}] URL: ${req.url}`);
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
  
  const { searchUrl, searchTerm } = req.body || {};
  
  console.log(`[${requestId}] Parsed searchUrl: "${searchUrl}"`);
  console.log(`[${requestId}] Parsed searchTerm: "${searchTerm}"`);
  
  if (!searchUrl && !searchTerm) {
    console.error(`[${requestId}] ERROR: Neither searchUrl nor searchTerm provided`);
    return res.status(400).json({ 
      error: 'searchUrl or searchTerm is required',
      receivedBody: req.body,
      requestId
    });
  }
  
  try {
    console.log(`[${requestId}] Starting scrape`);
    const startTime = Date.now();
    
    const results = await scrapeCJDropshipping(searchUrl || searchTerm, searchTerm);
    
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
