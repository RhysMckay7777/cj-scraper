const express = require('express');
const path = require('path');
const axios = require('axios');
const fs = require('fs');
const { searchCJProducts } = require('./cj-api-scraper');

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

// Analyze image with Google Vision API - DYNAMIC category detection
async function analyzeProductImage(imageUrl, searchTerm) {
  try {
    if (!GOOGLE_VISION_API_KEY && !process.env.GOOGLE_APPLICATION_CREDENTIALS && !GOOGLE_CREDENTIALS_JSON) {
      console.log('  ⚠️  Vision API not configured - skipping image detection');
      return true; // Default pass if no credentials
    }

    // Download image first
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 10000,
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

    console.log(`Vision API labels for ${imageUrl.substring(0, 50)}:`, detectedLabels.slice(0, 7));

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
    console.log(`  📋 Dynamic valid categories for "${searchTerm}":`, validCategoriesArray.slice(0, 10));

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
      console.log(`  ✅ Image PASSED: matches search category "${searchTerm}"`);
      return true;
    }

    console.log(`  ❌ Image rejected: labels don't match "${searchTerm}" category`);
    return false;

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

  try {
    console.log('[API MODE] Using CJ Official API');

    // Parse search term and filters from URL if provided
    let keyword = searchTerm || searchUrl;
    let filters = {};

    if (searchUrl && searchUrl.includes('cjdropshipping.com')) {
      const parsed = parseCJUrl(searchUrl);
      keyword = parsed.keyword;
      filters = parsed.filters;
    }

    const apiResult = await searchCJProducts(keyword, CJ_API_TOKEN, {
      pageNum: 1,
      pageSize: 100,
      verifiedWarehouse: filters.verifiedWarehouse
    });

    if (!apiResult.success) {
      throw new Error(apiResult.error || 'CJ API request failed');
    }

    // Apply text filtering
    const textFiltered = apiResult.products.filter(p => isRelevantProduct(p.title, keyword));

    // Apply image detection if enabled
    let finalProducts = textFiltered;
    if (useImageDetection && textFiltered.length > 0) {
      console.log(`Analyzing ${textFiltered.length} products with Google Vision...`);
      const imageFiltered = [];
      for (const product of textFiltered) {
        if (product.image && await analyzeProductImage(product.image, keyword)) {
          imageFiltered.push(product);
        }
      }
      finalProducts = imageFiltered;
    }

    const results = {
      success: true,
      method: 'CJ_API',
      searchTerm: keyword,
      filters: filters,
      totalFound: apiResult.totalProducts,
      textFiltered: textFiltered.length,
      imageFiltered: useImageDetection ? finalProducts.length : null,
      filtered: finalProducts.length,
      passRate: ((finalProducts.length / apiResult.totalProducts) * 100).toFixed(1) + '%',
      products: finalProducts,
      imageDetectionUsed: useImageDetection
    };

    res.json({ ...results, requestId });
  } catch (error) {
    console.error(`[${requestId}] Error:`, error);
    res.status(500).json({ error: error.message, requestId });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    endpoints: ['/api/scrape', '/api/upload-shopify', '/health']
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
