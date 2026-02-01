const express = require('express');
const path = require('path');
const puppeteer = require('puppeteer');

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

// STRICT AI-powered product relevance checker
function isRelevantProduct(productTitle, searchTerm) {
  const lowerTitle = productTitle.toLowerCase();
  const lowerSearch = searchTerm.toLowerCase();
  
  const searchWords = lowerSearch.split(' ').filter(w => w.length > 2);
  const allWordsPresent = searchWords.every(word => lowerTitle.includes(word));
  if (!allWordsPresent) return false;
  
  const invalidCategories = [
    'hoodie', 'sweatshirt', 'jacket', 'coat', 'sweater', 'shirt', 'pants', 'joggers',
    'pullover', 'cardigan', 'vest', 'shorts', 'leggings', 'dress', 'skirt',
    'shoes', 'sneakers', 'boots', 'slippers', 'sandals', 'loafers',
    'dog', 'cat', 'pet', 'puppy', 'kitten',
    'baby', 'infant', 'toddler', 'kids', 'children',
    'pillow', 'cushion', 'mat', 'rug', 'carpet', 'curtain', 'towel',
    'sheet', 'duvet', 'comforter', 'quilt cover',
    'scarf', 'shawl', 'gloves', 'mittens', 'hat', 'beanie'
  ];
  
  for (const invalid of invalidCategories) {
    if (lowerTitle.includes(invalid)) {
      const hasBlanketsAfter = lowerTitle.includes(invalid + ' blanket') || 
                               lowerTitle.includes(invalid + ' throw');
      if (!hasBlanketsAfter) return false;
    }
  }
  
  if (lowerSearch.includes('throw') && lowerSearch.includes('blanket')) {
    if (!lowerTitle.includes('throw') || !lowerTitle.includes('blanket')) return false;
  }
  
  if (lowerSearch.includes('sherpa')) {
    if (!lowerTitle.includes('sherpa')) return false;
  }
  
  return true;
}

// Parse CJ URL
function parseCJUrl(url) {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const match = pathname.match(/\/search\/(.+?)\.html/);
    const keyword = match ? decodeURIComponent(match[1]).replace(/\+/g, ' ') : '';
    const params = new URLSearchParams(urlObj.search);
    const filters = {};
    for (const [key, value] of params.entries()) {
      filters[key] = value;
    }
    console.log('Parsed URL:', { keyword, filters });
    return { keyword, filters };
  } catch (e) {
    console.error('URL parse error:', e);
    return { keyword: '', filters: {} };
  }
}

// Scrape CJ with Puppeteer
async function scrapeCJDropshipping(searchUrl, searchTerm = null) {
  let browser = null;
  const allProducts = [];
  
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    
    const page = await browser.newPage();
    
    let baseUrl, keyword, filters;
    
    if (searchUrl && searchUrl.includes('cjdropshipping.com')) {
      const parsed = parseCJUrl(searchUrl);
      keyword = parsed.keyword;
      filters = parsed.filters;
      delete filters.pageNum;
      baseUrl = `https://www.cjdropshipping.com/search/${encodeURIComponent(keyword)}.html`;
    } else {
      keyword = searchTerm || searchUrl;
      filters = {};
      baseUrl = `https://www.cjdropshipping.com/search/${encodeURIComponent(keyword)}.html`;
    }
    
    console.log('Scraping:', { keyword, filters, baseUrl });
    
    let currentPage = 1;
    let hasMorePages = true;
    let totalPages = null;
    
    while (hasMorePages) {
      const queryParams = new URLSearchParams({ pageNum: currentPage.toString(), ...filters });
      const url = `${baseUrl}?${queryParams.toString()}`;
      
      console.log(`Page ${currentPage}: ${url}`);
      
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await page.waitForSelector('[data-product-type]', { timeout: 10000 }).catch(() => {});
      
      if (currentPage === 1) {
        totalPages = await page.evaluate(() => {
          const paginationText = document.body.textContent;
          const pageMatch = paginationText.match(/Page\s+\d+\s+of\s+(\d+)/i) ||
                           paginationText.match(/\d+\s*\/\s*(\d+)/);
          if (pageMatch) return parseInt(pageMatch[1]);
          const paginationButtons = document.querySelectorAll('[class*="pagination"] button, [class*="page"] button');
          if (paginationButtons.length > 0) {
            const numbers = Array.from(paginationButtons)
              .map(btn => parseInt(btn.textContent))
              .filter(n => !isNaN(n));
            return numbers.length > 0 ? Math.max(...numbers) : 1;
          }
          return 1;
        });
        console.log(`Total pages: ${totalPages}`);
      }
      
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
      
      console.log(`Page ${currentPage}: ${pageProducts.length} products`);
      
      if (pageProducts.length === 0) {
        hasMorePages = false;
        break;
      }
      
      allProducts.push(...pageProducts);
      
      currentPage++;
      if (totalPages && currentPage > totalPages) {
        hasMorePages = false;
      }
      if (currentPage > 10) {
        console.log('Safety limit: 10 pages');
        hasMorePages = false;
      }
      
      if (hasMorePages) {
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }
    
    console.log(`Total: ${allProducts.length} products across ${currentPage - 1} pages`);
    
    const filtered = allProducts.filter(p => isRelevantProduct(p.title, keyword));
    console.log(`Filtered: ${filtered.length} (${((filtered.length/allProducts.length)*100).toFixed(1)}%)`);
    
    const rejected = allProducts.filter(p => !isRelevantProduct(p.title, keyword));
    if (rejected.length > 0) {
      console.log('Rejected samples:');
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
    return { success: false, error: error.message };
  } finally {
    if (browser) await browser.close();
  }
}

// API Routes
app.post('/api/scrape', async (req, res) => {
  const requestId = Date.now().toString(36);
  console.log(`[${requestId}] POST /api/scrape`, req.body);
  
  const { searchUrl, searchTerm } = req.body;
  
  if (!searchUrl && !searchTerm) {
    return res.status(400).json({ error: 'searchUrl or searchTerm required' });
  }
  
  try {
    const results = await scrapeCJDropshipping(searchUrl || searchTerm, searchTerm);
    res.json({ ...results, requestId });
  } catch (error) {
    console.error(`[${requestId}] Error:`, error);
    res.status(500).json({ error: error.message, requestId });
  }
});

// Serve React frontend
app.use(express.static(path.join(__dirname, '../frontend/build')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/build/index.html'));
});

app.listen(PORT, () => {
  console.log(`✅ CJ Scraper running on port ${PORT}`);
  console.log(`Frontend: http://localhost:${PORT}`);
  console.log(`API: http://localhost:${PORT}/api/scrape`);
});
