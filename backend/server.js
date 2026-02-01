const express = require('express');
const path = require('path');
const puppeteer = require('puppeteer');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 8080;

// Google Vision API Key (simpler than service account)
const GOOGLE_VISION_API_KEY = process.env.GOOGLE_VISION_API_KEY || '';

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
    if (!GOOGLE_VISION_API_KEY) {
      console.log('  ⚠️  Vision API key not configured - skipping image detection');
      return true; // Default pass if no API key
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
    
    // Call Vision API REST endpoint
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
    
    const labels = visionResponse.data.responses[0]?.labelAnnotations || [];
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

// Scrape CJ with Puppeteer
async function scrapeCJDropshipping(searchUrl, searchTerm = null, useImageDetection = true) {
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
    
    // STEP 1: Text filter (fast)
    console.log('\n=== STEP 1: Text Filtering ===');
    const textFiltered = allProducts.filter(p => isRelevantProduct(p.title, keyword));
    console.log(`Text filter: ${textFiltered.length}/${allProducts.length} passed (${((textFiltered.length/allProducts.length)*100).toFixed(1)}%)`);
    
    // STEP 2: Image detection (slow, only on text-passed products)
    let finalFiltered = textFiltered;
    
    if (useImageDetection && textFiltered.length > 0) {
      console.log('\n=== STEP 2: Image Detection (Google Vision API) ===');
      console.log(`Analyzing ${textFiltered.length} product images...`);
      
      const imageResults = [];
      
      for (let i = 0; i < textFiltered.length; i++) {
        const product = textFiltered[i];
        console.log(`[${i + 1}/${textFiltered.length}] Analyzing: ${product.title.substring(0, 50)}...`);
        
        if (!product.image || !product.image.startsWith('http')) {
          console.log('  ⚠️  No valid image URL - skipping Vision API');
          imageResults.push(product); // Keep products without images (default pass)
          continue;
        }
        
        const imageMatches = await analyzeProductImage(product.image, keyword);
        
        if (imageMatches) {
          imageResults.push(product);
        } else {
          console.log(`  ❌ Rejected: ${product.title}`);
        }
        
        // Small delay to avoid rate limiting
        if (i < textFiltered.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      
      finalFiltered = imageResults;
      console.log(`\nImage filter: ${finalFiltered.length}/${textFiltered.length} passed (${((finalFiltered.length/textFiltered.length)*100).toFixed(1)}%)`);
    }
    
    // Show rejected samples
    const rejected = allProducts.filter(p => !finalFiltered.includes(p));
    if (rejected.length > 0 && rejected.length < allProducts.length) {
      console.log('\nSample rejected products:');
      rejected.slice(0, 5).forEach(p => console.log(`  ❌ ${p.title}`));
    }
    
    return {
      success: true,
      searchTerm: keyword,
      filters: filters,
      totalFound: allProducts.length,
      textFiltered: textFiltered.length,
      imageFiltered: useImageDetection ? finalFiltered.length : null,
      filtered: finalFiltered.length,
      passRate: ((finalFiltered.length/allProducts.length)*100).toFixed(1) + '%',
      pagesScraped: currentPage - 1,
      products: finalFiltered,
      imageDetectionUsed: useImageDetection
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
  
  const { searchUrl, searchTerm, useImageDetection = true } = req.body;
  
  if (!searchUrl && !searchTerm) {
    return res.status(400).json({ error: 'searchUrl or searchTerm required' });
  }
  
  try {
    const results = await scrapeCJDropshipping(
      searchUrl || searchTerm, 
      searchTerm,
      useImageDetection
    );
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
