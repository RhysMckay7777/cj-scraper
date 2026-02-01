const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// ============================================
// CORS - Must be FIRST middleware
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

// Request logging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// ============================================
// CJ Dropshipping API Configuration
// ============================================
const CJ_API_BASE = 'https://developers.cjdropshipping.com/api2.0/v1';
const CJ_ACCESS_TOKEN = process.env.CJ_ACCESS_TOKEN || '';

// ============================================
// Health check
// ============================================
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => {
  res.json({ status: 'CJ Scraper API is running', version: '2.0', hasToken: !!CJ_ACCESS_TOKEN });
});

// AI-powered product relevance checker
function isRelevantProduct(productTitle, searchTerm) {
  const lowerTitle = productTitle.toLowerCase();
  const lowerSearch = searchTerm.toLowerCase();
  const searchWords = lowerSearch.split(' ').filter(w => w.length > 2);
  const primaryMatch = searchWords.some(word => lowerTitle.includes(word));
  if (!primaryMatch) return false;

  const falsePositives = [
    'summer blanket', 'air conditioning blanket', 'cooling blanket',
    'beach mat', 'pet blanket', 'dog blanket', 'cat blanket',
    'knitted blanket', 'cotton blanket', 'gauze', 'towel quilt',
    'children', 'infant', 'baby', 'mat', 'quilt'
  ];

  if (lowerSearch.includes('sherpa')) {
    if (!lowerTitle.includes('sherpa')) return false;
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
  console.log(`[CJ API] Token: ${CJ_ACCESS_TOKEN ? 'Set' : 'NOT SET!'}`);

  if (!CJ_ACCESS_TOKEN) {
    return {
      success: false,
      products: [],
      error: 'CJ_ACCESS_TOKEN not configured'
    };
  }

  try {
    // Use /product/list endpoint (confirmed working)
    const response = await axios.get(`${CJ_API_BASE}/product/list`, {
      params: {
        pageNum: 1,
        pageSize: 50,
        productNameEn: searchTerm,
        verifiedWarehouse: options.verifiedWarehouse ? 1 : undefined,
        countryCode: options.countryCode || undefined,
      },
      headers: {
        'CJ-Access-Token': CJ_ACCESS_TOKEN,
        'Content-Type': 'application/json',
      },
      timeout: 30000
    });

    console.log('[CJ API] Response code:', response.data?.code);

    if (response.data && response.data.code === 200 && response.data.data) {
      const products = response.data.data.list || [];
      console.log(`[CJ API] Found ${products.length} products (total: ${response.data.data.total})`);

      const mappedProducts = products.map(p => ({
        title: p.productNameEn || 'Unknown',
        price: `$${p.sellPrice || 0}`,
        lists: p.listedNum || 0,
        url: `https://cjdropshipping.com/product/${p.pid}.html`,
        image: p.productImage,
        sku: p.productSku,
        categoryName: p.categoryName || '',
        freeShipping: p.addMarkStatus === '1' || p.isFreeShipping === true,
        hasVideo: p.isVideo === 1,
        productType: p.productType,
      }));

      return {
        success: true,
        products: mappedProducts,
        total: response.data.data.total
      };
    } else {
      console.error('[CJ API] Error:', response.data?.message);
      return {
        success: false,
        products: [],
        error: response.data?.message || 'API error'
      };
    }
  } catch (error) {
    console.error('[CJ API] Error:', error.message);
    if (error.response) {
      console.error('[CJ API] Status:', error.response.status);
      console.error('[CJ API] Data:', JSON.stringify(error.response.data));
    }
    return { success: false, products: [], error: error.message };
  }
}

// ============================================
// Get product details
// ============================================
async function getProductDetails(pid) {
  try {
    const response = await axios.get(`${CJ_API_BASE}/product/query`, {
      params: { pid },
      headers: { 'CJ-Access-Token': CJ_ACCESS_TOKEN },
      timeout: 15000
    });

    if (response.data?.code === 200) {
      return { success: true, data: response.data.data };
    }
    return { success: false, error: response.data?.message };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ============================================
// Main search endpoint
// ============================================
app.post('/api/scrape', async (req, res) => {
  const { searchTerm, options } = req.body || {};

  console.log(`[Scrape] Request for: "${searchTerm}"`);

  if (!searchTerm) {
    return res.status(400).json({ error: 'searchTerm is required' });
  }

  try {
    const startTime = Date.now();
    const searchResult = await searchCJProducts(searchTerm.trim(), options || {});

    if (!searchResult.success) {
      return res.status(500).json({
        success: false,
        error: searchResult.error,
        products: []
      });
    }

    const allProducts = searchResult.products || [];
    const filtered = allProducts.filter(p => isRelevantProduct(p.title, searchTerm));

    const duration = Date.now() - startTime;
    const passRate = allProducts.length > 0
      ? ((filtered.length / allProducts.length) * 100).toFixed(1) + '%'
      : '0%';

    console.log(`[Scrape] Found ${allProducts.length}, filtered to ${filtered.length} in ${duration}ms`);

    res.json({
      success: true,
      searchTerm,
      totalFound: allProducts.length,
      totalAvailable: searchResult.total,
      filtered: filtered.length,
      passRate,
      products: filtered,
      processingTime: `${duration}ms`
    });

  } catch (error) {
    console.error('[Scrape] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// Get product details endpoint
// ============================================
app.get('/api/product/:pid', async (req, res) => {
  const { pid } = req.params;
  const result = await getProductDetails(pid);

  if (result.success) {
    res.json(result.data);
  } else {
    res.status(500).json({ error: result.error });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.url });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log('='.repeat(50));
  console.log(`CJ Scraper API running on port ${PORT}`);
  console.log(`CJ Token: ${CJ_ACCESS_TOKEN ? 'Configured' : 'NOT SET!'}`);
  console.log('='.repeat(50));
});
