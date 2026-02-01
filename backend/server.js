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
    fs.writeFileSync('./google-credentials.json', GOOGLE_CREDENTIALS_JSON);
    process.env.GOOGLE_APPLICATION_CREDENTIALS = './google-credentials.json';
    console.log('✅ Google Vision credentials loaded from JSON');
  } catch (e) {
    console.error('Failed to write credentials file:', e.message);
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

// Analyze image with Google Vision API
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
            features: [{ type: 'LABEL_DETECTION', maxResults: 10 }]
          }]
        },
        { timeout: 15000 }
      );
      
      labels = visionResponse.data.responses[0]?.labelAnnotations || [];
    }
    
    const detectedLabels = labels.map(l => l.description.toLowerCase());
    
    console.log(`Vision API labels for ${imageUrl.substring(0, 50)}:`, detectedLabels.slice(0, 5));
    
    // Build expected labels from search term
    const searchWords = searchTerm.toLowerCase().split(' ').filter(w => w.length > 2);
    
    // Define valid categories for blankets/textiles
    const validCategories = [
      'blanket', 'throw', 'textile', 'bedding', 'fabric', 'fleece', 
      'sherpa', 'plush', 'soft', 'bed', 'home', 'linen', 'cotton',
      'polyester', 'material', 'furnishing', 'comfort'
    ];
    
    // Invalid categories (things that are definitely NOT blankets)
    const invalidCategories = [
      'clothing', 'apparel', 'fashion', 'footwear', 'shoe', 'boot',
      'sneaker', 'watch', 'jewelry', 'accessory', 'toy', 'electronics',
      'gadget', 'tool', 'furniture', 'kitchen', 'appliance'
    ];
    
    // Check for invalid categories first
    const hasInvalidCategory = detectedLabels.some(label => 
      invalidCategories.some(invalid => label.includes(invalid))
    );
    
    if (hasInvalidCategory) {
      console.log(`  ❌ Image rejected: contains invalid category`);
      return false;
    }
    
    // Check if image contains valid textile/blanket-related labels
    const hasValidCategory = detectedLabels.some(label =>
      validCategories.some(valid => label.includes(valid))
    );
    
    // Also check if any search term words appear in labels
    const hasSearchTermMatch = searchWords.some(word =>
      detectedLabels.some(label => label.includes(word))
    );
    
    if (hasValidCategory || hasSearchTermMatch) {
      console.log(`  ✅ Image passed: valid category or search term match`);
      return true;
    }
    
    console.log(`  ❌ Image rejected: no valid category match`);
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
