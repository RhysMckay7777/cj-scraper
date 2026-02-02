const express = require('express');
const path = require('path');
const axios = require('axios');
const fs = require('fs');
const { searchCJProducts, getCJCategories, cancelScrape, generateScrapeId, MAX_OFFSET } = require('./cj-api-scraper');

// Track active scrape sessions for cancellation
const activeScrapes = new Map();

const app = express();
const PORT = process.env.PORT || 8080;

// CJ API Token (preferred method)
const CJ_API_TOKEN = process.env.CJ_API_TOKEN || '';

// Google Vision API - Support both API Key and Service Account
const GOOGLE_VISION_API_KEY = process.env.GOOGLE_VISION_API_KEY || '';
const GOOGLE_CREDENTIALS_JSON = process.env.GOOGLE_CREDENTIALS_JSON || '';

// If service account JSON provided as env var, write to file
if (GOOGLE_CREDENTIALS_JSON) {
  try {
    // Parse and re-stringify to validate JSON and handle escaped characters
    let credentials;
    try {
      credentials = JSON.parse(GOOGLE_CREDENTIALS_JSON);
    } catch (parseErr) {
      // Try replacing escaped newlines first
      const fixedJson = GOOGLE_CREDENTIALS_JSON.replace(/\\n/g, '\n');
      credentials = JSON.parse(fixedJson);
    }

    // Write valid JSON to file
    fs.writeFileSync('./google-credentials.json', JSON.stringify(credentials, null, 2));
    process.env.GOOGLE_APPLICATION_CREDENTIALS = './google-credentials.json';
    console.log('✅ Google Vision credentials loaded from JSON');
  } catch (e) {
    console.error('Failed to parse/write credentials:', e.message);
    console.log('⚠️ Continuing without Google Vision - text filter only');
  }
}

// Initialize Vision API
let visionAuth = null;
if (process.env.GOOGLE_APPLICATION_CREDENTIALS || GOOGLE_CREDENTIALS_JSON) {
  // Use service account
  console.log('Using Google Vision with Service Account');
} else if (GOOGLE_VISION_API_KEY) {
  // Use API key
  console.log('Using Google Vision with API Key');
} else {
  console.warn('⚠️  No Google Vision credentials - image detection disabled');
}

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

// VERY RELAXED text filter - let image detection do the heavy lifting
// Just need AT LEAST ONE search word to match - Vision API will filter out bad matches
function isRelevantProduct(productTitle, searchTerm) {
  const lowerTitle = productTitle.toLowerCase();
  const lowerSearch = searchTerm.toLowerCase();

  // Extract main keywords (words > 2 chars)
  const searchWords = lowerSearch.split(' ').filter(w => w.length > 2);

  // VERY RELAXED: At least ONE search word should be present
  // Image detection will catch false positives
  const matchingWords = searchWords.filter(word => lowerTitle.includes(word));

  // Pass if any word matches
  return matchingWords.length >= 1;
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

// Retry wrapper with exponential backoff
async function withRetry(fn, maxRetries = 3, baseDelayMs = 1000) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const isRetryable = error.code === 'ECONNRESET' ||
        error.code === 'ETIMEDOUT' ||
        error.code === 'ECONNREFUSED' ||
        error.message?.includes('timeout') ||
        error.message?.includes('429') ||
        (error.response?.status >= 500);

      if (!isRetryable || attempt === maxRetries) {
        throw error;
      }

      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      console.log(`  ⚠️ Retry ${attempt}/${maxRetries} after ${delay}ms: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

// Analyze image with Google Vision API - DYNAMIC category detection
// Now includes retry logic for transient errors
async function analyzeProductImage(imageUrl, searchTerm) {
  try {
    if (!GOOGLE_VISION_API_KEY && !process.env.GOOGLE_APPLICATION_CREDENTIALS && !GOOGLE_CREDENTIALS_JSON) {
      console.log('  ⚠️  Vision API not configured - skipping image detection');
      return true; // Default pass if no credentials
    }

    // Use retry wrapper for the entire operation
    return await withRetry(async () => {
      // Download image first
      const response = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 15000, // Increased timeout
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      const imageBuffer = Buffer.from(response.data);
      const base64Image = imageBuffer.toString('base64');

      let labels = [];

      // Try service account first, fallback to API key
      if (process.env.GOOGLE_APPLICATION_CREDENTIALS || GOOGLE_CREDENTIALS_JSON) {
        // Use @google-cloud/vision SDK
        const vision = require('@google-cloud/vision');
        const client = new vision.ImageAnnotatorClient();

        const [result] = await client.labelDetection({
          image: { content: imageBuffer }
        });

        labels = result.labelAnnotations || [];
      } else if (GOOGLE_VISION_API_KEY) {
        // Use REST API with API key
        const visionResponse = await axios.post(
          `https://vision.googleapis.com/v1/images:annotate?key=${GOOGLE_VISION_API_KEY}`,
          {
            requests: [{
              image: { content: base64Image },
              features: [{ type: 'LABEL_DETECTION', maxResults: 15 }]
            }]
          },
          { timeout: 15000 }
        );

        labels = visionResponse.data.responses[0]?.labelAnnotations || [];
      }

      const detectedLabels = labels.map(l => l.description.toLowerCase());

      // ===========================================
      // DYNAMIC CATEGORY DETECTION
      // ===========================================
      // Build valid categories from the search term DYNAMICALLY
      const searchLower = searchTerm.toLowerCase();
      const searchWords = searchLower.split(/[\s+]+/).filter(w => w.length > 2);

      // Semantic keyword expansions - maps keywords to related valid labels
      const keywordExpansions = {
        // Home textiles
        'blanket': ['blanket', 'throw', 'textile', 'fabric', 'fleece', 'bedding', 'wool', 'woolen', 'fur', 'velvet', 'flannel', 'plush', 'soft', 'warm', 'cozy', 'quilt', 'comforter', 'duvet', 'cover', 'material', 'natural material', 'knit', 'cotton', 'polyester', 'sherpa', 'coral'],
        'throw': ['throw', 'blanket', 'textile', 'fabric', 'bedding', 'wool', 'fur', 'soft', 'cozy'],
        'fleece': ['fleece', 'blanket', 'fabric', 'textile', 'soft', 'warm', 'wool', 'fur', 'material'],
        'pillow': ['pillow', 'cushion', 'textile', 'fabric', 'bedding', 'soft', 'stuffing', 'comfort'],
        'curtain': ['curtain', 'drape', 'textile', 'fabric', 'window', 'home', 'decor'],
        'rug': ['rug', 'carpet', 'mat', 'floor', 'textile', 'fabric', 'home'],

        // Electronics
        'led': ['led', 'light', 'lamp', 'lighting', 'bulb', 'strip', 'glow', 'bright', 'electric', 'wire', 'cable'],
        'light': ['light', 'lamp', 'led', 'lighting', 'bulb', 'glow', 'bright', 'illumination'],
        'phone': ['phone', 'mobile', 'smartphone', 'device', 'electronic', 'gadget', 'screen', 'case', 'cover'],
        'cable': ['cable', 'wire', 'cord', 'charger', 'usb', 'electric', 'connector'],
        'speaker': ['speaker', 'audio', 'sound', 'music', 'bluetooth', 'electronic'],

        // Kitchen
        'kitchen': ['kitchen', 'cookware', 'utensil', 'cooking', 'food', 'baking', 'tool', 'appliance'],
        'cup': ['cup', 'mug', 'drinkware', 'ceramic', 'glass', 'coffee', 'tea', 'beverage'],
        'plate': ['plate', 'dish', 'dinnerware', 'ceramic', 'tableware', 'food'],

        // Pets
        'dog': ['dog', 'pet', 'animal', 'canine', 'puppy', 'collar', 'leash', 'toy'],
        'cat': ['cat', 'pet', 'animal', 'feline', 'kitten', 'toy'],
        'pet': ['pet', 'animal', 'dog', 'cat', 'toy', 'collar', 'leash', 'bowl'],

        // Toys & Kids
        'toy': ['toy', 'play', 'game', 'fun', 'child', 'kid', 'baby', 'stuffed', 'plush'],
        'baby': ['baby', 'infant', 'child', 'kid', 'nursery', 'toddler'],

        // Clothing (if user wants clothing)
        'shirt': ['shirt', 'clothing', 'apparel', 'top', 'garment', 'textile', 'fabric', 'fashion'],
        'dress': ['dress', 'clothing', 'apparel', 'garment', 'fashion', 'textile'],
        'shoe': ['shoe', 'footwear', 'sneaker', 'boot', 'sandal', 'sole', 'leather'],

        // Jewelry & Accessories
        'jewelry': ['jewelry', 'jewellery', 'accessory', 'ring', 'necklace', 'bracelet', 'earring', 'gold', 'silver'],
        'watch': ['watch', 'timepiece', 'wrist', 'clock', 'accessory', 'band', 'strap'],
        'bag': ['bag', 'handbag', 'purse', 'backpack', 'luggage', 'pouch', 'case'],

        // Beauty
        'makeup': ['makeup', 'cosmetic', 'beauty', 'lipstick', 'brush', 'powder'],
        'skincare': ['skincare', 'cream', 'lotion', 'beauty', 'face', 'skin'],

        // Tools & Hardware
        'tool': ['tool', 'hardware', 'drill', 'wrench', 'screwdriver', 'equipment'],

        // Sports & Outdoor
        'sport': ['sport', 'fitness', 'exercise', 'gym', 'athletic', 'outdoor'],
        'camping': ['camping', 'outdoor', 'tent', 'hiking', 'adventure', 'nature']
      };

      // Build valid categories from search term
      let validCategories = new Set();

      // Add exact search words
      searchWords.forEach(word => {
        validCategories.add(word);

        // Expand with related terms
        if (keywordExpansions[word]) {
          keywordExpansions[word].forEach(related => validCategories.add(related));
        }

        // Also check partial matches
        Object.keys(keywordExpansions).forEach(key => {
          if (word.includes(key) || key.includes(word)) {
            keywordExpansions[key].forEach(related => validCategories.add(related));
          }
        });
      });

      const validCategoriesArray = Array.from(validCategories);

      // NOTE: Reject labels feature removed - caused too many false negatives
      // Vision's positive matching alone is sufficient (86% accuracy)

      // Check if any detected label matches our dynamic valid categories
      const hasValidMatch = detectedLabels.some(label =>
        validCategoriesArray.some(valid =>
          label.includes(valid) || valid.includes(label)
        )
      );

      // Also check direct search term match in labels
      const hasSearchTermMatch = searchWords.some(word =>
        detectedLabels.some(label => label.includes(word) || word.includes(label))
      );

      if (hasValidMatch || hasSearchTermMatch) {
        return true;
      }

      return false;
    }); // End withRetry callback

  } catch (error) {
    console.error('Vision API error:', error.message);
    // On error, default to PASS (don't reject due to API issues)
    return true;
  }
}


// Removed Puppeteer scraping - using CJ API exclusively for better reliability and speed

// API Routes
app.post('/api/scrape', async (req, res) => {
  const requestId = Date.now().toString(36);
  const scrapeId = generateScrapeId();
  console.log(`[${requestId}] POST /api/scrape`, req.body);

  const { searchUrl, searchTerm, useImageDetection = true } = req.body;

  if (!searchUrl && !searchTerm) {
    return res.status(400).json({ error: 'searchUrl or searchTerm required' });
  }

  // Require CJ API token
  if (!CJ_API_TOKEN) {
    return res.status(500).json({
      error: 'CJ_API_TOKEN environment variable is required. Puppeteer scraping has been removed for better reliability.'
    });
  }

  // Track this scrape session for cancellation
  activeScrapes.set(scrapeId, { cancelled: false, startedAt: Date.now() });

  try {
    console.log('[API MODE] Using CJ Official API');
    console.log(`[${requestId}] Scrape ID: ${scrapeId}`);

    // Parse search term and filters from URL if provided
    let keyword = searchTerm || searchUrl;
    let filters = {};

    if (searchUrl && searchUrl.includes('cjdropshipping.com')) {
      const parsed = parseCJUrl(searchUrl);
      keyword = parsed.keyword;
      filters = parsed.filters;
    }

    // Check for cancellation
    if (activeScrapes.get(scrapeId)?.cancelled) {
      throw new Error('Scrape cancelled by user');
    }

    // FIXED: Fetch ALL pages (up to MAX_OFFSET limit)
    const apiResult = await searchCJProducts(keyword, CJ_API_TOKEN, {
      pageNum: 1,
      pageSize: 200, // Max allowed by CJ API
      verifiedWarehouse: filters.verifiedWarehouse,
      categoryId: filters.categoryId || filters.id || null, // Support category filtering (CJ website uses 'id' param)
      startWarehouseInventory: filters.startWarehouseInventory || null, // BUG FIX: Pass inventory filters
      endWarehouseInventory: filters.endWarehouseInventory || null, // BUG FIX: Pass inventory filters
      fetchAllPages: true, // Fetch all pages up to MAX_OFFSET
      scrapeId: scrapeId
    });

    if (!apiResult.success) {
      throw new Error(apiResult.error || 'CJ API request failed');
    }

    // Check for cancellation
    if (activeScrapes.get(scrapeId)?.cancelled) {
      throw new Error('Scrape cancelled by user');
    }

    // Apply text filtering
    let textFiltered = apiResult.products.filter(p => isRelevantProduct(p.title, keyword));

    // BUG FIX: Limit total products to prevent runaway scrapes
    const MAX_PRODUCTS_TO_PROCESS = 1000;
    if (textFiltered.length > MAX_PRODUCTS_TO_PROCESS) {
      console.log(`⚠️ Limiting Vision analysis to first ${MAX_PRODUCTS_TO_PROCESS} products (found ${textFiltered.length})`);
      textFiltered = textFiltered.slice(0, MAX_PRODUCTS_TO_PROCESS);
    }

    // Apply image detection if enabled
    // REDUCED batch size from 30 to 10 to avoid Vision API rate limits
    let finalProducts = textFiltered;
    const BATCH_SIZE = 10; // Reduced from 30 for better rate limit handling
    const SCRAPE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes max scrape time
    const scrapeStartTime = Date.now();

    if (useImageDetection && textFiltered.length > 0) {
      console.log(`Analyzing ${textFiltered.length} products with Google Vision in batches of ${BATCH_SIZE}...`);
      const imageFiltered = [];

      // Process in parallel batches
      for (let i = 0; i < textFiltered.length; i += BATCH_SIZE) {
        // Check for cancellation at start of each batch
        if (activeScrapes.get(scrapeId)?.cancelled) {
          console.log(`[${requestId}] ⛔ Scrape cancelled during Vision processing`);
          break;
        }

        // BUG FIX: Check for timeout
        if (Date.now() - scrapeStartTime > SCRAPE_TIMEOUT_MS) {
          console.log(`[${requestId}] ⏱️ Scrape timeout reached (${SCRAPE_TIMEOUT_MS / 1000 / 60} minutes), stopping...`);
          break;
        }

        const batch = textFiltered.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(textFiltered.length / BATCH_SIZE);

        console.log(`  Processing batch ${batchNum}/${totalBatches} (${batch.length} products)...`);

        // Analyze all products in batch simultaneously
        const batchResults = await Promise.all(
          batch.map(async (product) => {
            if (product.image) {
              const passed = await analyzeProductImage(product.image, keyword);
              return { product, passed };
            }
            return { product, passed: false };
          })
        );

        // Collect passed products
        batchResults.forEach(result => {
          if (result.passed) {
            imageFiltered.push(result.product);
          }
        });

        console.log(`  Batch ${batchNum} complete: ${batchResults.filter(r => r.passed).length}/${batch.length} passed`);

        // Increased delay between batches to avoid rate limiting (1.5s instead of 1s)
        if (i + BATCH_SIZE < textFiltered.length) {
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
      }

      finalProducts = imageFiltered;
    }

    // Cleanup scrape session
    activeScrapes.delete(scrapeId);

    const results = {
      success: true,
      method: 'CJ_API',
      searchTerm: keyword,
      filters: filters,
      totalFound: apiResult.totalProducts,
      maxFetchable: apiResult.maxFetchablePages ? apiResult.maxFetchablePages * 200 : null,
      pagesScraped: apiResult.fetchedPages || 1,
      textFiltered: textFiltered.length,
      imageFiltered: useImageDetection ? finalProducts.length : null,
      filtered: finalProducts.length,
      passRate: ((finalProducts.length / apiResult.totalProducts) * 100).toFixed(1) + '%',
      products: finalProducts,
      imageDetectionUsed: useImageDetection,
      scrapeId: scrapeId
    };

    // Clean summary log
    console.log(`\n========== SCRAPE SUMMARY ==========`);
    console.log(`Search Term: "${keyword}"`);
    console.log(`Filters: ${JSON.stringify(filters)}`);
    const usedCategoryId = filters.categoryId || filters.id || null;
    console.log(`Category ID: ${usedCategoryId || 'NONE - will return ALL products!'}`);
    console.log(`---`);
    console.log(`📥 CJ API: ${apiResult.totalProducts} total (${apiResult.fetchedPages || 1} pages scraped)`);
    if (apiResult.maxFetchablePages && apiResult.totalProducts > apiResult.maxFetchablePages * 200) {
      console.log(`⚠️  Note: Only ${apiResult.maxFetchablePages * 200} products accessible (API offset limit: ${MAX_OFFSET})`);
    }
    console.log(`📥 Actually Fetched: ${apiResult.actualFetched || apiResult.products?.length || 0} products`);
    console.log(`---`);
    console.log(`📝 Text Filter: ${textFiltered.length}/${apiResult.actualFetched || apiResult.totalProducts} passed (${((textFiltered.length / (apiResult.actualFetched || apiResult.totalProducts)) * 100).toFixed(1)}%)`);
    if (useImageDetection) {
      console.log(`🖼️  Image Filter: ${finalProducts.length}/${textFiltered.length} passed (${textFiltered.length > 0 ? ((finalProducts.length / textFiltered.length) * 100).toFixed(1) : 0}%)`);
    }
    console.log(`---`);
    console.log(`✅ FINAL: ${finalProducts.length} products (${results.passRate} overall pass rate)`);
    console.log(`=====================================\n`);

    res.json({ ...results, requestId });
  } catch (error) {
    // Cleanup scrape session on error
    activeScrapes.delete(scrapeId);
    console.error(`[${requestId}] Error:`, error);
    res.status(500).json({ error: error.message, requestId, scrapeId });
  }
});

// Cancel a scrape in progress
app.post('/api/scrape/cancel', (req, res) => {
  const { scrapeId } = req.body;

  if (!scrapeId) {
    return res.status(400).json({ error: 'scrapeId is required' });
  }

  if (activeScrapes.has(scrapeId)) {
    activeScrapes.get(scrapeId).cancelled = true;
    cancelScrape(scrapeId); // Also cancel in cj-api-scraper
    console.log(`[CANCEL] Scrape ${scrapeId} cancelled`);
    res.json({ success: true, message: `Scrape ${scrapeId} cancelled` });
  } else {
    res.json({ success: false, message: 'Scrape not found or already completed' });
  }
});

// Cancel all active scrapes
app.post('/api/scrape/cancel-all', (req, res) => {
  const cancelled = [];
  activeScrapes.forEach((session, id) => {
    session.cancelled = true;
    cancelScrape(id);
    cancelled.push(id);
  });
  activeScrapes.clear();
  console.log(`[CANCEL] All scrapes cancelled: ${cancelled.length}`);
  res.json({ success: true, cancelled: cancelled.length, ids: cancelled });
});

// Get CJ categories endpoint
app.get('/api/categories', async (req, res) => {
  if (!CJ_API_TOKEN) {
    return res.status(500).json({ error: 'CJ_API_TOKEN environment variable is required' });
  }

  try {
    const result = await getCJCategories(CJ_API_TOKEN);

    if (!result.success) {
      throw new Error(result.error || 'Failed to fetch categories');
    }

    // Filter to only level 3 categories (the ones with IDs)
    const level3Categories = result.categories.filter(cat => cat.level === 3);

    res.json({
      success: true,
      categories: level3Categories,
      total: level3Categories.length
    });
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ error: error.message });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    endpoints: ['/api/scrape', '/api/categories', '/api/upload-shopify', '/health']
  });
});

// Upload products to Shopify
app.post('/api/upload-shopify', async (req, res) => {
  const requestId = Date.now().toString(36);
  console.log(`[${requestId}] POST /api/upload-shopify`);

  const { products, markup = 250, shopifyStore, shopifyToken } = req.body;

  if (!products || !Array.isArray(products) || products.length === 0) {
    return res.status(400).json({ error: 'Products array is required', requestId });
  }

  if (!shopifyStore || !shopifyToken) {
    return res.status(400).json({
      error: 'Shopify credentials required. Configure your store in Settings.',
      requestId
    });
  }

  try {
    const results = [];

    // Upload products sequentially to avoid rate limits
    for (const product of products) {
      try {
        // Parse price
        const priceMatch = (product.price || '0').toString().match(/[\d.]+/);
        const price = priceMatch ? parseFloat(priceMatch[0]) : 0;
        const sellingPrice = price * (markup / 100);
        const comparePrice = sellingPrice * 1.3;

        // Create product via Shopify REST API
        const productData = {
          product: {
            title: product.title || 'Untitled Product',
            vendor: 'CJ Dropshipping',
            product_type: 'Imported',
            status: 'active', // Publish immediately
            tags: ['dropship', 'cj', product.sourceKeyword || ''].filter(Boolean).join(', '),
            variants: [{
              price: sellingPrice.toFixed(2),
              compare_at_price: comparePrice.toFixed(2),
              inventory_management: null,
              sku: product.sku || ''
            }],
            images: product.image ? [{ src: product.image }] : []
          }
        };

        const response = await axios.post(
          `https://${shopifyStore}/admin/api/2024-01/products.json`,
          productData,
          {
            headers: {
              'X-Shopify-Access-Token': shopifyToken,
              'Content-Type': 'application/json'
            }
          }
        );

        results.push({
          title: product.title,
          success: true,
          productId: response.data.product.id,
          shopifyUrl: `https://${shopifyStore}/admin/products/${response.data.product.id}`
        });

        console.log(`[${requestId}] ✅ Uploaded: ${product.title}`);

        // Delay to respect Shopify rate limits (2 calls/second)
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (error) {
        console.error(`[${requestId}] ❌ Failed: ${product.title}`, error.response?.data || error.message);
        results.push({
          title: product.title,
          success: false,
          error: error.response?.data?.errors || error.message
        });
      }
    }

    const successCount = results.filter(r => r.success).length;

    res.json({
      success: true,
      requestId,
      total: products.length,
      uploaded: successCount,
      failed: products.length - successCount,
      results
    });

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
