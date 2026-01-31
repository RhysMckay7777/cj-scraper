const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// CORS configuration for production
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5173',
  process.env.FRONTEND_URL, // Set this in Render to your Vercel URL
].filter(Boolean);

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin) || process.env.NODE_ENV !== 'production') {
      callback(null, true);
    } else {
      console.log('Blocked by CORS:', origin);
      callback(null, true); // Allow all in case origin not in list (for flexibility)
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
};

app.use(cors(corsOptions));
app.use(express.json());

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
  // Configure chromium for serverless environment
  chromium.setHeadlessMode = true;
  chromium.setGraphicsMode = false;

  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

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
    await browser.close();
  }
}

// API Routes
app.post('/api/scrape', async (req, res) => {
  const { searchTerm, options } = req.body;

  if (!searchTerm) {
    return res.status(400).json({ error: 'searchTerm is required' });
  }

  try {
    const results = await scrapeCJDropshipping(searchTerm, options || {});
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`CJ Scraper API running on port ${PORT}`);
});
