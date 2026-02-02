const express = require('express');
const path = require('path');
const axios = require('axios');
const fs = require('fs');
const { searchCJProducts, getCJCategories, cancelScrape, generateScrapeId, MAX_OFFSET } = require('./cj-api-scraper');
const { getCategoryIndex, searchCategories } = require('./category-service');
const { mapSearchToCategories, generateDynamicKeywords } = require('./ai-keyword-generator');

// Gemini API Key for dynamic keyword generation
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

// ============================================
// DEBUG: Global error handlers to catch crashes
// ============================================
process.on('uncaughtException', (err) => {
  console.error('💥 UNCAUGHT EXCEPTION:', err.message);
  console.error('Stack:', err.stack);
  // Don't exit - let Render handle it
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 UNHANDLED REJECTION at:', promise);
  console.error('Reason:', reason);
});

// Memory logging utility
function logMemory(checkpoint) {
  const used = process.memoryUsage();
  const mb = (bytes) => (bytes / 1024 / 1024).toFixed(2) + 'MB';
  console.log(`[MEMORY:${checkpoint}] Heap: ${mb(used.heapUsed)}/${mb(used.heapTotal)} | RSS: ${mb(used.rss)} | External: ${mb(used.external)}`);
}

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
// IMPORTANT: Increase body size limit for large product uploads (286+ products)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
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

  // ===== TEXT-BASED REJECT PATTERNS =====
  // If searching for throws/blankets, reject products with "pillow" in title
  const textRejectPatterns = {
    'throw': ['pillow', 'cushion', 'pillowcase', 'cushion cover'],
    'blanket': ['pillow', 'cushion', 'pillowcase'],
    'fur': ['keychain', 'key chain', 'pendant', 'earring'],
  };

  // Check if title contains reject terms for this search
  for (const [searchKey, rejectTerms] of Object.entries(textRejectPatterns)) {
    if (lowerSearch.includes(searchKey)) {
      // Check if any reject term is in the title WITHOUT the search term nearby
      for (const reject of rejectTerms) {
        if (lowerTitle.includes(reject)) {
          // Special case: "throw pillow" is explicitly a pillow, not a throw blanket
          if (lowerTitle.includes('throw pillow') || lowerTitle.includes('throw pillows')) {
            console.log(`[Text Filter] ❌ Rejected "${title.substring(0, 50)}..." - contains "throw pillow"`);
            return false;
          }
          // If title has pillow but NOT blanket/throw (as a blanket), reject
          if (!lowerTitle.includes('blanket') && !lowerTitle.includes('throw blanket')) {
            console.log(`[Text Filter] ❌ Rejected "${title.substring(0, 50)}..." - contains "${reject}"`);
            return false;
          }
        }
      }
    }
  }

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

// Analyze image with Google Vision API - DYNAMIC AI-powered filtering
// Supports both static fallback and AI-generated valid/reject keywords
async function analyzeProductImage(imageUrl, searchTerm, imageIndex = 0, dynamicKeywords = null) {
  const startTime = Date.now();
  try {
    if (!GOOGLE_VISION_API_KEY && !process.env.GOOGLE_APPLICATION_CREDENTIALS && !GOOGLE_CREDENTIALS_JSON) {
      return true; // Default pass if no credentials
    }

    // Use retry wrapper for the entire operation
    return await withRetry(async () => {
      // Download image first
      console.log(`    [Vision:${imageIndex}] Downloading image...`);
      const response = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      const imageBuffer = Buffer.from(response.data);
      const base64Image = imageBuffer.toString('base64');
      console.log(`    [Vision:${imageIndex}] Downloaded (${(imageBuffer.length / 1024).toFixed(1)}KB) - Calling API...`);

      let labels = [];

      // Try service account first, fallback to API key
      if (process.env.GOOGLE_APPLICATION_CREDENTIALS || GOOGLE_CREDENTIALS_JSON) {
        const vision = require('@google-cloud/vision');
        const client = new vision.ImageAnnotatorClient();
        const [result] = await client.labelDetection({
          image: { content: imageBuffer }
        });
        labels = result.labelAnnotations || [];
      } else if (GOOGLE_VISION_API_KEY) {
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
      console.log(`    [Vision:${imageIndex}] Detected: ${detectedLabels.slice(0, 5).join(', ')}`);

      // ===========================================
      // AI-POWERED DYNAMIC FILTERING
      // ===========================================

      let validLabels = [];
      let rejectLabels = [];

      if (dynamicKeywords && dynamicKeywords.valid && dynamicKeywords.reject) {
        // Use AI-generated keywords
        validLabels = dynamicKeywords.valid.map(l => l.toLowerCase());
        rejectLabels = dynamicKeywords.reject.map(l => l.toLowerCase());

        // ===== CRITICAL: CHECK REJECT LABELS FIRST =====
        // This catches false positives like pillows in a throw search
        const hasRejectLabel = detectedLabels.some(label =>
          rejectLabels.some(reject =>
            label.includes(reject) || reject.includes(label)
          )
        );

        if (hasRejectLabel) {
          const matchedReject = detectedLabels.filter(label =>
            rejectLabels.some(reject =>
              label.includes(reject) || reject.includes(label)
            )
          );
          console.log(`    [Vision:${imageIndex}] ❌ REJECTED by: ${matchedReject.join(', ')}`);
          return false;
        }

        // Check valid labels
        const hasValidMatch = detectedLabels.some(label =>
          validLabels.some(valid =>
            label.includes(valid) || valid.includes(label)
          )
        );

        if (hasValidMatch) {
          console.log(`    [Vision:${imageIndex}] ✅ PASSED (valid label match)`);
          return true;
        }

        console.log(`    [Vision:${imageIndex}] ❌ REJECTED (no valid labels)`);
        return false;
      }

      // ===========================================
      // FALLBACK: Static keyword expansion
      // ===========================================
      const searchLower = searchTerm.toLowerCase();
      const searchWords = searchLower.split(/[\s+]+/).filter(w => w.length > 2);

      // Static keyword expansions as fallback
      const keywordExpansions = {
        'blanket': ['blanket', 'throw', 'textile', 'fabric', 'fleece', 'bedding', 'wool', 'fur', 'plush', 'soft'],
        'throw': ['throw', 'blanket', 'textile', 'fabric', 'wool', 'fur', 'soft', 'cozy', 'plush'],
        'pillow': ['pillow', 'cushion', 'textile', 'fabric', 'bedding', 'soft'],
        'phone': ['phone', 'mobile', 'smartphone', 'device', 'electronic', 'screen', 'case'],
        'dog': ['dog', 'pet', 'animal', 'canine', 'collar', 'leash', 'toy'],
        'cat': ['cat', 'pet', 'animal', 'feline', 'toy'],
        'light': ['light', 'lamp', 'led', 'lighting', 'bulb'],
        'kitchen': ['kitchen', 'cookware', 'utensil', 'cooking'],
        'bag': ['bag', 'handbag', 'purse', 'backpack', 'luggage']
      };

      let validCategories = new Set();
      searchWords.forEach(word => {
        validCategories.add(word);
        if (keywordExpansions[word]) {
          keywordExpansions[word].forEach(related => validCategories.add(related));
        }
        Object.keys(keywordExpansions).forEach(key => {
          if (word.includes(key) || key.includes(word)) {
            keywordExpansions[key].forEach(related => validCategories.add(related));
          }
        });
      });

      const validCategoriesArray = Array.from(validCategories);
      const hasValidMatch = detectedLabels.some(label =>
        validCategoriesArray.some(valid =>
          label.includes(valid) || valid.includes(label)
        )
      );

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
    // BATCH PROCESSING: Process 50 images at a time for max speed (2GB RAM has headroom)
    // Batch size: 10 for 1GB, 25 for 2GB (safe), 50 for 2GB (fast), 100 for 4GB+
    const VISION_BATCH_SIZE = 50; // 50 parallel requests = max speed for 2GB
    let finalProducts = textFiltered;
    const SCRAPE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes max scrape time
    const scrapeStartTime = Date.now();

    if (useImageDetection && textFiltered.length > 0) {
      logMemory('VISION_START');

      // ===============================================
      // NEW: Generate dynamic AI keywords for filtering
      // ===============================================
      let dynamicKeywords = null;
      if (GEMINI_API_KEY) {
        console.log(`\n🤖 [AI] Generating dynamic keywords for "${keyword}"...`);
        try {
          dynamicKeywords = await generateDynamicKeywords(keyword, GEMINI_API_KEY);
          console.log(`🤖 [AI] Valid labels: ${dynamicKeywords.valid?.slice(0, 5).join(', ')}...`);
          console.log(`🤖 [AI] Reject labels: ${dynamicKeywords.reject?.join(', ') || 'none'}`);
          console.log(`🤖 [AI] Confidence: ${dynamicKeywords.confidence || 'unknown'}`);
        } catch (aiError) {
          console.log(`⚠️ [AI] Keyword generation failed: ${aiError.message}, using static fallback`);
        }
      } else {
        console.log(`ℹ️ [AI] No GEMINI_API_KEY, using static keyword matching`);
      }

      console.log(`Analyzing ${textFiltered.length} products with Google Vision in batches of ${VISION_BATCH_SIZE}...`);
      console.log(`Estimated time: ${Math.ceil(textFiltered.length / VISION_BATCH_SIZE * 1.5)} seconds`);
      const imageFiltered = [];
      const totalBatches = Math.ceil(textFiltered.length / VISION_BATCH_SIZE);

      // BATCH PROCESSING: Process VISION_BATCH_SIZE images in parallel
      for (let i = 0; i < textFiltered.length; i += VISION_BATCH_SIZE) {
        // Check for cancellation
        if (activeScrapes.get(scrapeId)?.cancelled) {
          console.log(`[${requestId}] ⛔ Scrape cancelled during Vision processing`);
          break;
        }

        // Check for timeout
        if (Date.now() - scrapeStartTime > SCRAPE_TIMEOUT_MS) {
          console.log(`[${requestId}] ⏱️ Scrape timeout reached (${SCRAPE_TIMEOUT_MS / 1000 / 60} minutes), stopping...`);
          break;
        }

        const batch = textFiltered.slice(i, i + VISION_BATCH_SIZE);
        const batchNum = Math.floor(i / VISION_BATCH_SIZE) + 1;

        console.log(`  Batch ${batchNum}/${totalBatches}: processing ${batch.length} images...`);
        logMemory(`BATCH_${batchNum}_START`);

        // Process batch in PARALLEL for speed
        const batchResults = await Promise.all(
          batch.map(async (product, idx) => {
            try {
              if (product.image) {
                const passed = await analyzeProductImage(product.image, keyword, i + idx, dynamicKeywords);
                return { product, passed };
              }
              return { product, passed: false };
            } catch (err) {
              console.error(`  [${i + idx}] Vision error: ${err.message}`);
              return { product, passed: false };
            }
          })
        );

        // Collect passed products
        batchResults.forEach(result => {
          if (result.passed) {
            imageFiltered.push(result.product);
          }
        });

        const passedCount = batchResults.filter(r => r.passed).length;
        console.log(`  Batch ${batchNum}/${totalBatches}: ${passedCount}/${batch.length} passed`);
        logMemory(`BATCH_${batchNum}_END`);

        // Force garbage collection hint between batches if available
        if (global.gc) {
          global.gc();
        }

        // Small delay between batches to allow memory cleanup (500ms)
        if (i + VISION_BATCH_SIZE < textFiltered.length) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      console.log(`Vision analysis complete: ${imageFiltered.length}/${textFiltered.length} passed`);
      logMemory('VISION_END');
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

// Track active uploads for cancellation
const activeUploads = new Map();

// Upload products to Shopify
app.post('/api/upload-shopify', async (req, res) => {
  const requestId = Date.now().toString(36);
  const uploadId = `upload_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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

  // No limit on products - upload all of them to Shopify
  // Using GraphQL productSet batch mutations for fast uploads with variants + images
  let productsToUpload = products;
  console.log(`[${requestId}] Preparing to upload ${productsToUpload.length} products with GraphQL productSet...`);

  // Track this upload for cancellation
  activeUploads.set(uploadId, { cancelled: false, startedAt: Date.now() });

  // GraphQL batch configuration
  const BATCH_SIZE = 30; // 30 products per GraphQL request (optimized for speed)
  const GRAPHQL_ENDPOINT = `https://${shopifyStore}/admin/api/2026-01/graphql.json`;

  // Helper: Build productSet input for GraphQL variables
  const buildProductSetInput = (product) => {
    const priceMatch = (product.price || '0').toString().match(/[\d.]+/);
    const price = priceMatch ? parseFloat(priceMatch[0]) : 0;
    const sellingPrice = price * (markup / 100);
    const comparePrice = sellingPrice * 1.3;

    const input = {
      title: product.title || 'Untitled Product',
      vendor: 'CJ Dropshipping',
      productType: 'Imported',
      status: 'ACTIVE', // Enum - GraphQL variables handle this automatically
      tags: ['dropship', 'cj', product.sourceKeyword || ''].filter(Boolean),
      // Single variant product - use default option
      productOptions: [{
        name: 'Title',
        position: 1,
        values: [{ name: 'Default Title' }]
      }],
      variants: [{
        optionValues: [{ optionName: 'Title', name: 'Default Title' }],
        price: sellingPrice.toFixed(2),
        compareAtPrice: comparePrice.toFixed(2),
        sku: product.sku || ''
      }]
    };

    // Add image if available
    if (product.image) {
      input.files = [{
        originalSource: product.image,
        contentType: 'IMAGE' // Enum - GraphQL variables handle this automatically
      }];
    }

    return input;
  };

  try {
    const results = [];
    const batches = [];

    // Split products into batches
    for (let i = 0; i < productsToUpload.length; i += BATCH_SIZE) {
      batches.push(productsToUpload.slice(i, i + BATCH_SIZE));
    }

    console.log(`[${requestId}] Uploading ${productsToUpload.length} products in ${batches.length} batches of ${BATCH_SIZE}...`);

    // Process each batch
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];

      // Check for cancellation
      if (activeUploads.get(uploadId)?.cancelled) {
        console.log(`[${requestId}] ⛔ Upload cancelled at batch ${batchIndex + 1}/${batches.length}`);
        break;
      }

      // Build GraphQL mutation with variables (handles enums automatically!)
      const varDefs = batch.map((_, i) => `$input${i}: ProductSetInput!`).join(', ');
      const mutations = batch.map((_, i) => {
        const alias = `p${batchIndex * BATCH_SIZE + i}`;
        return `
          ${alias}: productSet(synchronous: true, input: $input${i}) {
            product { 
              id 
              title
              handle
            }
            userErrors { 
              field 
              message 
            }
          }
        `;
      }).join('\n');

      const mutation = `mutation BatchProductSet(${varDefs}) { ${mutations} }`;

      // Build variables object - JSON format, GraphQL handles type conversion!
      const variables = {};
      batch.forEach((product, i) => {
        variables[`input${i}`] = buildProductSetInput(product);
      });

      try {
        const response = await axios.post(GRAPHQL_ENDPOINT, {
          query: mutation,
          variables: variables // ✅ GraphQL handles enum conversion automatically!
        }, {
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': shopifyToken
          },
          timeout: 120000 // 2 minute timeout for batch with images
        });

        const { data, errors, extensions } = response.data;

        // Check for GraphQL-level errors
        if (errors) {
          console.error(`[${requestId}] GraphQL errors:`, errors);
          batch.forEach(product => {
            results.push({
              title: product.title,
              success: false,
              error: errors[0]?.message || 'GraphQL error'
            });
          });
        } else if (data) {
          // Process each aliased result
          Object.keys(data).forEach((alias, index) => {
            const result = data[alias];
            const product = batch[index];

            if (result?.product) {
              results.push({
                title: product.title,
                success: true,
                productId: result.product.id,
                handle: result.product.handle
              });
            } else if (result?.userErrors?.length > 0) {
              results.push({
                title: product.title,
                success: false,
                error: result.userErrors.map(e => e.message).join(', ')
              });
            } else {
              results.push({
                title: product.title,
                success: false,
                error: 'Unknown error'
              });
            }
          });
        }

        // Check throttle status and wait if needed
        const throttle = extensions?.cost?.throttleStatus;
        if (throttle) {
          const availablePercent = throttle.currentlyAvailable / throttle.maximumAvailable;
          console.log(`[${requestId}] ✅ Batch ${batchIndex + 1}/${batches.length} done | Rate limit: ${(availablePercent * 100).toFixed(0)}%`);

          if (availablePercent < 0.2) {
            console.log(`[${requestId}] ⏳ Low rate limit, waiting 3s...`);
            await new Promise(resolve => setTimeout(resolve, 3000));
          } else if (availablePercent < 0.4) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        } else {
          console.log(`[${requestId}] ✅ Batch ${batchIndex + 1}/${batches.length} done`);
        }

        // Delay between batches
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (error) {
        console.error(`[${requestId}] ❌ Batch ${batchIndex + 1} failed:`, error.response?.data || error.message);

        // Check for rate limiting
        if (error.response?.status === 429) {
          const retryAfter = parseInt(error.response.headers['retry-after']) || 3;
          console.log(`[${requestId}] ⏳ Rate limited, retrying after ${retryAfter}s...`);
          await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
          batchIndex--; // Retry this batch
          continue;
        }

        // Mark all products in batch as failed
        batch.forEach(product => {
          results.push({
            title: product.title,
            success: false,
            error: error.response?.data?.errors?.[0]?.message || error.message
          });
        });
      }
    }

    // Cleanup
    activeUploads.delete(uploadId);

    const successCount = results.filter(r => r.success).length;
    const failedCount = results.filter(r => !r.success).length;

    console.log(`[${requestId}] ========== UPLOAD COMPLETE ==========`);
    console.log(`[${requestId}] ✅ Success: ${successCount}/${products.length}`);
    console.log(`[${requestId}] ❌ Failed: ${failedCount}/${products.length}`);
    console.log(`[${requestId}] ======================================`);

    res.json({
      success: true,
      requestId,
      total: products.length,
      uploaded: successCount,
      failed: failedCount,
      results,
      uploadId,
      method: 'GraphQL productSet Batch',
      batchSize: BATCH_SIZE
    });

  } catch (error) {
    activeUploads.delete(uploadId);
    console.error(`[${requestId}] Error:`, error);
    res.status(500).json({ error: error.message, requestId });
  }
});

// Cancel all active uploads
app.post('/api/upload-shopify/cancel-all', (req, res) => {
  const cancelled = [];
  activeUploads.forEach((session, id) => {
    session.cancelled = true;
    cancelled.push(id);
  });
  activeUploads.clear();
  console.log(`[CANCEL] All uploads cancelled: ${cancelled.length}`);
  res.json({ success: true, cancelled: cancelled.length, ids: cancelled });
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
