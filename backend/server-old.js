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

// Helper function for CJ API calls
async function callCJApi(endpoint, params = {}, method = 'GET', body = null) {
  const config = {
    method,
    url: `${CJ_API_BASE}${endpoint}`,
    headers: {
      'CJ-Access-Token': CJ_ACCESS_TOKEN,
      'Content-Type': 'application/json',
    },
    timeout: 30000
  };

  if (method === 'GET' && Object.keys(params).length > 0) {
    config.params = params;
  }
  if (body) {
    config.data = body;
  }

  console.log(`[CJ API] ${method} ${endpoint}`);
  const response = await axios(config);
  return response.data;
}

// ============================================
// Health check
// ============================================
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => {
  res.json({
    status: 'CJ Scraper API is running',
    version: '2.0',
    hasToken: !!CJ_ACCESS_TOKEN,
    endpoints: [
      'POST /api/scrape - Search products',
      'GET /api/categories - Get all categories',
      'GET /api/warehouses - Get global warehouses',
      'GET /api/product/:pid - Get product details',
      'GET /api/product/:pid/variants - Get product variants',
      'GET /api/product/:pid/inventory - Get product inventory',
      'GET /api/product/:pid/reviews - Get product reviews',
      'GET /api/inventory/sku/:sku - Get inventory by SKU',
      'GET /api/inventory/variant/:vid - Get inventory by variant',
      'POST /api/my-products/add - Add to my products',
      'GET /api/my-products - Get my products',
      'POST /api/sourcing/create - Create sourcing request',
      'POST /api/sourcing/query - Query sourcing status',
    ]
  });
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
// 1. CATEGORIES - GET /api/categories
// ============================================
app.get('/api/categories', async (req, res) => {
  try {
    const result = await callCJApi('/product/getCategory');
    if (result.code === 200) {
      res.json({ success: true, data: result.data });
    } else {
      res.status(400).json({ success: false, error: result.message });
    }
  } catch (error) {
    console.error('[Categories] Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// 2. GLOBAL WAREHOUSES - GET /api/warehouses
// ============================================
app.get('/api/warehouses', async (req, res) => {
  try {
    const result = await callCJApi('/product/globalWarehouseList');
    if (result.code === 200) {
      res.json({ success: true, data: result.data });
    } else {
      res.status(400).json({ success: false, error: result.message });
    }
  } catch (error) {
    console.error('[Warehouses] Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// 3. PRODUCT SEARCH - POST /api/scrape
// Fetches MULTIPLE PAGES to get ALL relevant products
// ============================================
app.post('/api/scrape', async (req, res) => {
  const { searchTerm, options = {} } = req.body || {};

  console.log(`[Scrape] Request for: "${searchTerm}"`);

  if (!searchTerm) {
    return res.status(400).json({ error: 'searchTerm is required' });
  }

  if (!CJ_ACCESS_TOKEN) {
    return res.status(500).json({ error: 'CJ_ACCESS_TOKEN not configured' });
  }

  try {
    const startTime = Date.now();
    const pageSize = Math.min(options.pageSize || 200, 200); // Max 200 per page
    const maxPages = options.maxPages || 50; // Default: fetch ALL pages (up to 10,000 products)

    let allProducts = [];
    let currentPage = 1;
    let totalAvailable = 0;
    let hasMore = true;

    // Fetch multiple pages to get ALL products
    while (hasMore && currentPage <= maxPages) {
      const params = {
        pageNum: currentPage,
        pageSize: pageSize,
        productNameEn: searchTerm.trim(),
      };

      // Optional filters from docs
      if (options.categoryId) params.categoryId = options.categoryId;
      if (options.countryCode) params.countryCode = options.countryCode;
      if (options.verifiedWarehouse) params.verifiedWarehouse = options.verifiedWarehouse;
      if (options.minPrice) params.minPrice = options.minPrice;
      if (options.maxPrice) params.maxPrice = options.maxPrice;
      if (options.isFreeShipping !== undefined) params.isFreeShipping = options.isFreeShipping ? 1 : 0;
      if (options.deliveryTime) params.deliveryTime = options.deliveryTime;
      if (options.sort) params.sort = options.sort;
      if (options.orderBy) params.orderBy = options.orderBy;

      console.log(`[Scrape] Fetching page ${currentPage}...`);
      const result = await callCJApi('/product/list', params);

      if (result.code !== 200) {
        if (currentPage === 1) {
          return res.status(400).json({ success: false, error: result.message });
        }
        break; // Stop if subsequent pages fail
      }

      const products = result.data?.list || [];
      totalAvailable = result.data?.total || 0;

      console.log(`[Scrape] Page ${currentPage}: ${products.length} products (total available: ${totalAvailable})`);

      // Map and add products
      products.forEach(p => {
        allProducts.push({
          pid: p.pid,
          title: p.productNameEn || 'Unknown',
          price: p.sellPrice,
          priceFormatted: `$${p.sellPrice || 0}`,
          lists: p.listedNum || 0,
          url: `https://cjdropshipping.com/product/${p.pid}.html`,
          image: p.productImage,
          sku: p.productSku,
          categoryId: p.categoryId,
          categoryName: p.categoryName || '',
          freeShipping: p.addMarkStatus === '1' || p.isFreeShipping === true,
          hasVideo: p.isVideo === 1,
          productType: p.productType,
          weight: p.productWeight,
          supplierName: p.supplierName,
          supplierId: p.supplierId,
        });
      });

      // Check if there are more pages
      hasMore = products.length === pageSize && allProducts.length < totalAvailable;
      currentPage++;

      // Small delay to avoid rate limiting (CJ allows ~1 req/sec)
      if (hasMore && currentPage <= maxPages) {
        await new Promise(resolve => setTimeout(resolve, 1200));
      }
    }

    // Apply AI filtering
    const filtered = allProducts.filter(p => isRelevantProduct(p.title, searchTerm));

    const duration = Date.now() - startTime;
    const passRate = allProducts.length > 0
      ? ((filtered.length / allProducts.length) * 100).toFixed(1) + '%'
      : '0%';

    console.log(`[Scrape] Total: ${allProducts.length} products across ${currentPage - 1} pages, filtered to ${filtered.length} in ${duration}ms`);

    res.json({
      success: true,
      searchTerm,
      pagesFetched: currentPage - 1,
      totalFound: allProducts.length,
      totalAvailable,
      filtered: filtered.length,
      passRate,
      products: filtered,
      processingTime: `${duration}ms`
    });

  } catch (error) {
    console.error('[Scrape] Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});


// ============================================
// 4. PRODUCT DETAILS - GET /api/product/:pid
// ============================================
app.get('/api/product/:pid', async (req, res) => {
  const { pid } = req.params;
  const { features, countryCode } = req.query;

  try {
    const params = { pid };
    if (features) params.features = features; // enable_combine, enable_video, enable_inventory
    if (countryCode) params.countryCode = countryCode;

    const result = await callCJApi('/product/query', params);

    if (result.code === 200) {
      res.json({ success: true, data: result.data });
    } else {
      res.status(400).json({ success: false, error: result.message });
    }
  } catch (error) {
    console.error('[Product Details] Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// 5. PRODUCT VARIANTS - GET /api/product/:pid/variants
// ============================================
app.get('/api/product/:pid/variants', async (req, res) => {
  const { pid } = req.params;
  const { countryCode } = req.query;

  try {
    const params = { pid };
    if (countryCode) params.countryCode = countryCode;

    const result = await callCJApi('/product/variant/query', params);

    if (result.code === 200) {
      res.json({ success: true, data: result.data });
    } else {
      res.status(400).json({ success: false, error: result.message });
    }
  } catch (error) {
    console.error('[Variants] Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// 6. VARIANT BY ID - GET /api/variant/:vid
// ============================================
app.get('/api/variant/:vid', async (req, res) => {
  const { vid } = req.params;
  const { features } = req.query; // enable_inventory

  try {
    const params = { vid };
    if (features) params.features = features;

    const result = await callCJApi('/product/variant/queryByVid', params);

    if (result.code === 200) {
      res.json({ success: true, data: result.data });
    } else {
      res.status(400).json({ success: false, error: result.message });
    }
  } catch (error) {
    console.error('[Variant] Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// 7. INVENTORY BY PRODUCT - GET /api/product/:pid/inventory
// ============================================
app.get('/api/product/:pid/inventory', async (req, res) => {
  const { pid } = req.params;

  try {
    const result = await callCJApi('/product/stock/getInventoryByPid', { pid });

    if (result.code === 200) {
      res.json({ success: true, data: result.data });
    } else {
      res.status(400).json({ success: false, error: result.message });
    }
  } catch (error) {
    console.error('[Inventory by PID] Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// 8. INVENTORY BY SKU - GET /api/inventory/sku/:sku
// ============================================
app.get('/api/inventory/sku/:sku', async (req, res) => {
  const { sku } = req.params;

  try {
    const result = await callCJApi('/product/stock/queryBySku', { sku });

    if (result.code === 200) {
      res.json({ success: true, data: result.data });
    } else {
      res.status(400).json({ success: false, error: result.message });
    }
  } catch (error) {
    console.error('[Inventory by SKU] Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// 9. INVENTORY BY VARIANT - GET /api/inventory/variant/:vid
// ============================================
app.get('/api/inventory/variant/:vid', async (req, res) => {
  const { vid } = req.params;

  try {
    const result = await callCJApi('/product/stock/queryByVid', { vid });

    if (result.code === 200) {
      res.json({ success: true, data: result.data });
    } else {
      res.status(400).json({ success: false, error: result.message });
    }
  } catch (error) {
    console.error('[Inventory by VID] Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// 10. PRODUCT REVIEWS - GET /api/product/:pid/reviews
// ============================================
app.get('/api/product/:pid/reviews', async (req, res) => {
  const { pid } = req.params;
  const { score, pageNum = 1, pageSize = 20 } = req.query;

  try {
    const params = { pid, pageNum, pageSize };
    if (score) params.score = score;

    const result = await callCJApi('/product/productComments', params);

    if (result.code === 200 || result.code === 0) {
      res.json({ success: true, data: result.data });
    } else {
      res.status(400).json({ success: false, error: result.message });
    }
  } catch (error) {
    console.error('[Reviews] Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// 11. MY PRODUCTS - GET /api/my-products
// ============================================
app.get('/api/my-products', async (req, res) => {
  const { keyword, categoryId, startAt, endAt, isListed, pageNum = 1, pageSize = 10 } = req.query;

  try {
    const params = { pageNum, pageSize };
    if (keyword) params.keyword = keyword;
    if (categoryId) params.categoryId = categoryId;
    if (startAt) params.startAt = startAt;
    if (endAt) params.endAt = endAt;
    if (isListed !== undefined) params.isListed = isListed;

    const result = await callCJApi('/product/myProduct/query', params);

    if (result.code === 200) {
      res.json({ success: true, data: result.data });
    } else {
      res.status(400).json({ success: false, error: result.message });
    }
  } catch (error) {
    console.error('[My Products] Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// 12. ADD TO MY PRODUCTS - POST /api/my-products/add
// ============================================
app.post('/api/my-products/add', async (req, res) => {
  const { productId } = req.body;

  if (!productId) {
    return res.status(400).json({ success: false, error: 'productId is required' });
  }

  try {
    const result = await callCJApi('/product/addToMyProduct', {}, 'POST', { productId });

    if (result.code === 200) {
      res.json({ success: true, data: result.data });
    } else {
      res.status(400).json({ success: false, error: result.message });
    }
  } catch (error) {
    console.error('[Add to My Products] Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// 13. CREATE SOURCING - POST /api/sourcing/create
// ============================================
app.post('/api/sourcing/create', async (req, res) => {
  const { productName, productImage, productUrl, price, remark, thirdProductId, thirdVariantId, thirdProductSku } = req.body;

  if (!productName || !productImage) {
    return res.status(400).json({ success: false, error: 'productName and productImage are required' });
  }

  try {
    const body = {
      productName,
      productImage,
      productUrl: productUrl || '',
      price: price || '',
      remark: remark || '',
      thirdProductId: thirdProductId || '',
      thirdVariantId: thirdVariantId || '',
      thirdProductSku: thirdProductSku || '',
    };

    const result = await callCJApi('/product/sourcing/create', {}, 'POST', body);

    if (result.code === 200 || result.code === 0) {
      res.json({ success: true, data: result.data });
    } else {
      res.status(400).json({ success: false, error: result.message });
    }
  } catch (error) {
    console.error('[Create Sourcing] Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// 14. QUERY SOURCING - POST /api/sourcing/query
// ============================================
app.post('/api/sourcing/query', async (req, res) => {
  const { sourceIds } = req.body;

  if (!sourceIds || !Array.isArray(sourceIds)) {
    return res.status(400).json({ success: false, error: 'sourceIds array is required' });
  }

  try {
    const result = await callCJApi('/product/sourcing/query', {}, 'POST', { sourceIds });

    if (result.code === 200 || result.code === 0) {
      res.json({ success: true, data: result.data });
    } else {
      res.status(400).json({ success: false, error: result.message });
    }
  } catch (error) {
    console.error('[Query Sourcing] Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// 15. UPLOAD TO SHOPIFY - POST /api/upload-shopify
// Creates products using Shopify GraphQL Admin API
// ============================================
app.post('/api/upload-shopify', async (req, res) => {
  const { products, shopifyStore, shopifyToken, markup = 250 } = req.body;

  console.log(`[Shopify Upload] Request to upload ${products?.length} products to ${shopifyStore}`);

  if (!products || !Array.isArray(products) || products.length === 0) {
    return res.status(400).json({ success: false, error: 'products array is required' });
  }

  if (!shopifyStore || !shopifyToken) {
    return res.status(400).json({ success: false, error: 'shopifyStore and shopifyToken are required' });
  }

  try {
    let uploaded = 0;
    let failed = 0;
    const errors = [];

    // GraphQL mutation for creating products
    const productCreateMutation = `
      mutation productCreate($input: ProductInput!, $media: [CreateMediaInput!]) {
        productCreate(input: $input, media: $media) {
          product {
            id
            title
            handle
            variants(first: 1) {
              nodes {
                id
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    // Mutation to update variant price after product creation
    const variantUpdateMutation = `
      mutation productVariantUpdate($input: ProductVariantInput!) {
        productVariantUpdate(input: $input) {
          productVariant {
            id
            price
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    // Process each product
    for (const product of products) {
      try {
        // Calculate markup price
        const costPrice = parseFloat(product.price) || 0;
        const sellPrice = (costPrice * (markup / 100)).toFixed(2);
        const compareAtPrice = (costPrice * ((markup + 50) / 100)).toFixed(2);

        // Build GraphQL variables
        const variables = {
          input: {
            title: product.title,
            descriptionHtml: `<p>High-quality product sourced from verified suppliers.</p>
                              <p><strong>SKU:</strong> ${product.sku || 'N/A'}</p>
                              <p><strong>Category:</strong> ${product.categoryName || 'General'}</p>`,
            vendor: product.supplierName || 'CJ Dropshipping',
            productType: product.categoryName || 'General',
            status: 'DRAFT',
            tags: [
              product.sourceKeyword || '',
              product.categoryName || '',
              product.freeShipping ? 'Free Shipping' : '',
              'CJ Dropshipping'
            ].filter(Boolean),
            // Note: productCreate auto-creates a default variant
            // Variants must be updated separately with productVariantUpdate
          },
          media: product.image ? [
            {
              originalSource: product.image,
              mediaContentType: 'IMAGE',
            }
          ] : []
        };

        // Make GraphQL request to Shopify
        const shopifyResponse = await axios.post(
          `https://${shopifyStore}/admin/api/2024-01/graphql.json`,
          {
            query: productCreateMutation,
            variables: variables
          },
          {
            headers: {
              'X-Shopify-Access-Token': shopifyToken,
              'Content-Type': 'application/json',
            },
            timeout: 30000
          }
        );

        const result = shopifyResponse.data?.data?.productCreate;
        const gqlErrors = shopifyResponse.data?.errors;

        if (gqlErrors) {
          failed++;
          const errorMsg = gqlErrors.map(e => e.message).join(', ');
          console.error(`[Shopify] GraphQL Error "${product.title}":`, errorMsg);
          errors.push({ title: product.title, error: errorMsg });
        } else if (result?.product?.id) {
          // Step 2: Update the default variant with price
          const variantId = result.product.variants?.nodes?.[0]?.id;

          if (variantId) {
            try {
              await axios.post(
                `https://${shopifyStore}/admin/api/2024-01/graphql.json`,
                {
                  query: variantUpdateMutation,
                  variables: {
                    input: {
                      id: variantId,
                      price: sellPrice,
                      compareAtPrice: compareAtPrice,
                      sku: product.sku || `CJ-${product.pid || Date.now()}`,
                    }
                  }
                },
                {
                  headers: {
                    'X-Shopify-Access-Token': shopifyToken,
                    'Content-Type': 'application/json',
                  },
                  timeout: 15000
                }
              );
            } catch (variantErr) {
              console.log(`[Shopify] Variant update failed (product still created): ${variantErr.message}`);
            }
          }

          uploaded++;
          console.log(`[Shopify] Created: ${product.title} @ $${sellPrice} (${result.product.id})`);
        } else if (result?.userErrors?.length > 0) {
          failed++;
          const errorMsg = result.userErrors.map(e => e.message).join(', ');
          console.error(`[Shopify] Failed "${product.title}":`, errorMsg);
          errors.push({ title: product.title, error: errorMsg });
        }

        // Delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (productError) {
        failed++;
        const errorMsg = productError.response?.data?.errors || productError.message;
        console.error(`[Shopify] Error "${product.title}":`, errorMsg);
        errors.push({ title: product.title, error: JSON.stringify(errorMsg) });
      }
    }

    console.log(`[Shopify Upload] Complete: ${uploaded} uploaded, ${failed} failed`);

    res.json({
      success: true,
      uploaded,
      failed,
      total: products.length,
      errors: errors.slice(0, 5)
    });

  } catch (error) {
    console.error('[Shopify Upload] Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// 404 handler
// ============================================
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.url });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log('='.repeat(50));
  console.log(`CJ Scraper API running on port ${PORT}`);
  console.log(`CJ Token: ${CJ_ACCESS_TOKEN ? 'Configured' : 'NOT SET!'}`);
  console.log('Full API documentation at: GET /');
  console.log('='.repeat(50));
});
