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

// Parse JSON bodies
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
// Health check - MUST BE EARLY
// ============================================
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => {
  res.json({ status: 'CJ Scraper API is running', version: '2.0' });
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

  try {
    // Try CJ's public product search API
    const response = await axios.get('https://cjdropshipping.com/api/product/list', {
      params: {
        pageNum: 1,
        pageSize: 50,
        productNameEn: searchTerm,
      },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
      timeout: 15000
    });

    console.log('[CJ API] Response status:', response.status);

    if (response.data && response.data.data) {
      const products = response.data.data.list || response.data.data || [];

      const mappedProducts = products.map(p => ({
        title: p.productNameEn || p.productName || p.title || 'Unknown',
        price: `$${p.sellPrice || p.productPrice || p.price || 0}`,
        lists: p.listedNum || 0,
        url: `https://cjdropshipping.com/product/${p.pid || p.id}.html`,
        image: p.productImage,
      }));

      return { success: true, products: mappedProducts };
    }

    return { success: true, products: [] };
  } catch (error) {
    console.error('[CJ API] Error:', error.message);
    // Return empty array on error - don't crash
    return { success: true, products: [], error: error.message };
  }
}

// ============================================
// Main API endpoint
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

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.url });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log('='.repeat(50));
  console.log(`CJ Scraper API running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log('='.repeat(50));
});
