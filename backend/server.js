const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// ============================================
// CORS - Manual headers (most reliable method)
// ============================================
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');

  if (req.method === 'OPTIONS') {
    console.log('[CORS] Preflight request from:', req.headers.origin);
    return res.status(200).end();
  }
  next();
});

app.use(express.json());

// ============================================
// CJ Dropshipping API Configuration
// ============================================
const CJ_API_BASE = 'https://developers.cjdropshipping.com/api2.0/v1';
const CJ_ACCESS_TOKEN = process.env.CJ_ACCESS_TOKEN || '';

// AI-powered product relevance checker
function isRelevantProduct(productTitle, searchTerm) {
  const lowerTitle = productTitle.toLowerCase();
  const lowerSearch = searchTerm.toLowerCase();

  // Extract key words from search term
  const searchWords = lowerSearch.split(' ').filter(w => w.length > 2);

  // Must contain primary search term
  const primaryMatch = searchWords.some(word => lowerTitle.includes(word));
  if (!primaryMatch) return false;

  // Detect false positives for sherpa blanket searches
  const falsePositives = [
    'summer blanket', 'air conditioning blanket', 'cooling blanket',
    'beach mat', 'pet blanket', 'dog blanket', 'cat blanket',
    'knitted blanket', 'cotton blanket', 'gauze', 'towel quilt',
    'children', 'infant', 'baby', 'mat', 'quilt'
  ];

  if (lowerSearch.includes('sherpa')) {
    if (!lowerTitle.includes('sherpa')) return false;
    if (lowerTitle.includes('pet') && !lowerTitle.includes('sherpa')) return false;
  }

  for (const falsePos of falsePositives) {
    if (lowerTitle.includes(falsePos) && !lowerTitle.includes(lowerSearch)) {
      return false;
    }
  }

  return true;
}

// ============================================
// Search products using CJ's official API
// ============================================
async function searchCJProducts(searchTerm, options = {}) {
  console.log(`[CJ API] Searching for: "${searchTerm}"`);

  // Check if we have an access token
  if (!CJ_ACCESS_TOKEN) {
    console.log('[CJ API] No access token - using public search endpoint');
    // Fallback: Use public product listing (no auth required)
    return await searchCJPublic(searchTerm, options);
  }

  try {
    const response = await axios.get(`${CJ_API_BASE}/product/list`, {
      params: {
        productNameEn: searchTerm,
        pageNum: 1,
        pageSize: 50,
      },
      headers: {
        'CJ-Access-Token': CJ_ACCESS_TOKEN,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });

    console.log('[CJ API] Response:', response.data);

    if (response.data.code === 200 && response.data.data) {
      const products = response.data.data.list || [];

      // Map to our format
      const mappedProducts = products.map(p => ({
        title: p.productNameEn || p.productName,
        price: `$${p.sellPrice || p.productPrice || 0}`,
        lists: p.listedNum || 0,
        url: `https://cjdropshipping.com/product/${p.pid}.html`,
        image: p.productImage,
        sku: p.productSku
      }));

      return {
        success: true,
        products: mappedProducts,
        total: mappedProducts.length,
        source: 'cj-api'
      };
    } else {
      throw new Error(response.data.message || 'API returned error');
    }
  } catch (error) {
    console.error('[CJ API] Error:', error.message);
    // Fallback to public search
    return await searchCJPublic(searchTerm, options);
  }
}

// ============================================
// Public search (no auth required)
// Uses CJ's public product feed
// ============================================
async function searchCJPublic(searchTerm, options = {}) {
  console.log(`[CJ Public] Searching for: "${searchTerm}"`);

  try {
    // CJ's public search API endpoint
    const response = await axios.get('https://cjdropshipping.com/api/product/productSearch/list', {
      params: {
        pageNum: 1,
        pageSize: 50,
        productNameEn: searchTerm,
        verifiedWarehouse: options.verifiedWarehouse ? 1 : undefined,
      },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
      timeout: 30000
    });

    if (response.data && response.data.data) {
      const products = response.data.data.list || response.data.data || [];

      const mappedProducts = products.map(p => ({
        title: p.productNameEn || p.productName || p.title || 'Unknown Product',
        price: `$${p.sellPrice || p.productPrice || p.price || 0}`,
        lists: p.listedNum || p.lists || 0,
        url: p.productUrl || `https://cjdropshipping.com/product/${p.pid || p.id}.html`,
        image: p.productImage || p.image,
        sku: p.productSku || p.sku
      }));

      return {
        success: true,
        products: mappedProducts,
        total: mappedProducts.length,
        source: 'cj-public'
      };
    }

    // If public API doesn't work, return empty results
    return {
      success: true,
      products: [],
      total: 0,
      source: 'cj-public-empty'
    };
  } catch (error) {
    console.error('[CJ Public] Error:', error.message);
    return {
      success: false,
      error: error.message,
      products: [],
      total: 0
    };
  }
}

// ============================================
// Request Logging Middleware  
// ============================================
app.use((req, res, next) => {
  const requestId = Date.now().toString(36) + Math.random().toString(36).substr(2);
  req.requestId = requestId;

  console.log('='.repeat(60));
  console.log(`[${requestId}] ${req.method} ${req.url} at ${new Date().toISOString()}`);
  console.log(`[${requestId}] Origin: ${req.headers.origin || 'none'}`);
  if (req.body && Object.keys(req.body).length > 0) {
    console.log(`[${requestId}] Body:`, JSON.stringify(req.body));
  }
  console.log('='.repeat(60));

  next();
});

// ============================================
// API Routes
// ============================================
app.post('/api/scrape', async (req, res) => {
  const { searchTerm, options } = req.body || {};
  const requestId = req.requestId;

  console.log(`[${requestId}] Processing search for: "${searchTerm}"`);

  if (!searchTerm) {
    return res.status(400).json({
      error: 'searchTerm is required',
      requestId
    });
  }

  try {
    const startTime = Date.now();

    // Search using CJ API
    const searchResult = await searchCJProducts(searchTerm.trim(), options || {});

    if (!searchResult.success) {
      return res.status(500).json({
        error: searchResult.error || 'Search failed',
        requestId
      });
    }

    // Filter relevant products using AI logic
    const allProducts = searchResult.products;
    const filtered = allProducts.filter(p => isRelevantProduct(p.title, searchTerm));

    const duration = Date.now() - startTime;
    const passRate = allProducts.length > 0
      ? ((filtered.length / allProducts.length) * 100).toFixed(1) + '%'
      : '0%';

    console.log(`[${requestId}] Found ${allProducts.length} products, ${filtered.length} passed filter (${passRate})`);
    console.log(`[${requestId}] Completed in ${duration}ms`);

    res.json({
      success: true,
      searchTerm,
      totalFound: allProducts.length,
      filtered: filtered.length,
      passRate,
      products: filtered,
      source: searchResult.source,
      requestId,
      processingTime: `${duration}ms`
    });

  } catch (error) {
    console.error(`[${requestId}] FATAL ERROR:`, error.message);
    res.status(500).json({
      error: error.message,
      requestId
    });
  }
});

app.get('/health', (req, res) => {
  console.log('[Health] Health check requested');
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    hasApiToken: !!CJ_ACCESS_TOKEN
  });
});

// Catch-all for undefined routes
app.use((req, res) => {
  console.error(`[404] Route not found: ${req.method} ${req.url}`);
  res.status(404).json({
    error: 'Route not found',
    method: req.method,
    path: req.url
  });
});

app.listen(PORT, () => {
  console.log('='.repeat(60));
  console.log(`🚀 CJ Scraper API running on port ${PORT}`);
  console.log(`📦 Using CJ API (no Puppeteer)`);
  console.log(`🔑 CJ Access Token: ${CJ_ACCESS_TOKEN ? 'Configured' : 'Not set (using public API)'}`);
  console.log('='.repeat(60));
});
