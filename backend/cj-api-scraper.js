const axios = require('axios');

const CJ_API_BASE = 'https://developers.cjdropshipping.com/api2.0/v1';

// CJ API has a hard limit of 6000 max offset
const MAX_OFFSET = 6000;

// Track active scrape sessions for cancellation
const activeScrapes = new Map();

/**
 * Generate a unique scrape session ID
 */
function generateScrapeId() {
  return `scrape_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Cancel an active scrape session
 */
function cancelScrape(scrapeId) {
  if (activeScrapes.has(scrapeId)) {
    activeScrapes.get(scrapeId).cancelled = true;
    activeScrapes.delete(scrapeId);
    console.log(`[CJ API] Scrape ${scrapeId} cancelled`);
    return true;
  }
  return false;
}

/**
 * Check if a scrape is cancelled
 */
function isCancelled(scrapeId) {
  const session = activeScrapes.get(scrapeId);
  return session ? session.cancelled : false;
}

/**
 * Search CJ products using their official API
 * Uses /product/list for exact keyword matching (not elasticsearch)
 * @param {string} searchTerm - Product search keyword
 * @param {string} cjToken - CJ API token
 * @param {object} options - Optional filters
 */
async function searchCJProducts(searchTerm, cjToken, options = {}) {
  try {
    const {
      pageNum = 1,
      pageSize = 100,
      verifiedWarehouse = null,
      categoryId = null,
      startWarehouseInventory = null,
      endWarehouseInventory = null,
      fetchAllPages = false, // Option to fetch all pages
      scrapeId = null // For cancellation support
    } = options;

    console.log(`[CJ API] Searching for: "${searchTerm}" (page ${pageNum})`);

    // Build query parameters - using /product/list (not listV2)
    // This endpoint uses exact keyword matching, not elasticsearch
    const params = new URLSearchParams({
      productNameEn: searchTerm,
      pageNum: pageNum.toString(),
      pageSize: Math.min(pageSize, 200).toString() // Max 200 per API docs
    });

    if (verifiedWarehouse) {
      params.append('verifiedWarehouse', verifiedWarehouse.toString());
    }

    // NEW: Add category filtering if provided
    if (categoryId) {
      params.append('categoryId', categoryId.toString());
      console.log(`[CJ API] Filtering by categoryId: ${categoryId}`);
    }

    // BUG FIX: Add inventory filtering if provided
    if (startWarehouseInventory) {
      params.append('startInventory', startWarehouseInventory.toString());
      console.log(`[CJ API] Filtering by startInventory: ${startWarehouseInventory}`);
    }

    if (endWarehouseInventory) {
      params.append('endInventory', endWarehouseInventory.toString());
      console.log(`[CJ API] Filtering by endInventory: ${endWarehouseInventory}`);
    }

    // Use /product/list instead of /product/listV2
    const response = await axios.get(`${CJ_API_BASE}/product/list?${params.toString()}`, {
      headers: {
        'CJ-Access-Token': cjToken,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });

    // Log response for debugging
    console.log('[CJ API] Response code:', response.data.code);
    console.log('[CJ API] Response message:', response.data.message);

    if (response.data.code !== 200) {
      throw new Error(`CJ API Error: ${response.data.message || 'Unknown error'}`);
    }

    const data = response.data.data;

    // /product/list returns: { pageNum, pageSize, total, list: [...] }
    const productList = data.list || [];
    const totalCount = data.total || productList.length;
    // Use API's actual pageSize for pagination calculation, not our requested one
    const apiPageSize = data.pageSize || pageSize;
    const totalPages = Math.ceil(totalCount / apiPageSize);

    console.log(`[CJ API] API Response: total=${totalCount}, pageSize=${apiPageSize}, pageNum=${data.pageNum}`);
    console.log(`[CJ API] Found ${totalCount} total products across ${totalPages} pages (${apiPageSize} per page)`);
    console.log(`[CJ API] Page ${pageNum}: received ${productList.length} products`);

    // Helper function to generate URL slug from product name
    const generateSlug = (name) => {
      return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    };

    // Transform CJ API response to our format
    // /product/list uses: productNameEn, productImage, pid, sellPrice
    let products = productList.map(product => {
      const productName = product.productNameEn || product.productName || '';
      const slug = generateSlug(productName);

      return {
        title: productName,
        price: `$${product.sellPrice || 0}`,
        lists: product.listedNum || 0,
        url: `https://cjdropshipping.com/product/${slug}-p-${product.pid}.html`,
        image: product.productImage || '',
        sku: product.productSku || '',
        pid: product.pid || '',
        categoryId: product.categoryId || '',
        variants: product.variants || []
      };
    });

    // NEW: Fetch all pages if requested (with offset limit protection)
    if (fetchAllPages && totalPages > 1) {
      // Calculate max pages we can actually fetch due to offset limit
      const maxFetchablePages = Math.floor(MAX_OFFSET / apiPageSize);
      const actualMaxPages = Math.min(totalPages, maxFetchablePages);

      if (totalPages > maxFetchablePages) {
        console.log(`[CJ API] ⚠️ Total ${totalPages} pages exceeds API limit. Can only fetch ${maxFetchablePages} pages (offset limit: ${MAX_OFFSET})`);
      }

      console.log(`[CJ API] Fetching remaining ${actualMaxPages - 1} pages...`);

      // Register this scrape session for cancellation support
      const sessionId = scrapeId || generateScrapeId();
      activeScrapes.set(sessionId, { cancelled: false, startedAt: Date.now() });

      for (let page = 2; page <= actualMaxPages; page++) {
        // Check for cancellation
        if (isCancelled(sessionId)) {
          console.log(`[CJ API] ⛔ Scrape cancelled at page ${page}/${actualMaxPages}`);
          break;
        }

        // Add delay to avoid rate limiting (CJ API limit: 1 request per second)
        await new Promise(resolve => setTimeout(resolve, 1100));

        const nextPageResult = await searchCJProducts(searchTerm, cjToken, {
          ...options,
          pageNum: page,
          fetchAllPages: false, // Don't recurse infinitely
          scrapeId: sessionId
        });

        if (nextPageResult.success) {
          products = products.concat(nextPageResult.products);
          console.log(`[CJ API] Fetched page ${page}/${actualMaxPages} - Total products so far: ${products.length}`);
        } else {
          console.error(`[CJ API] Failed to fetch page ${page}: ${nextPageResult.error}`);
          // If we hit the offset error, stop fetching
          if (nextPageResult.error && nextPageResult.error.includes('max offset')) {
            console.log(`[CJ API] ⛔ Hit max offset limit, stopping pagination`);
            break;
          }
        }
      }

      // Cleanup session
      activeScrapes.delete(sessionId);

      console.log(`[CJ API] ✅ Fetched ${Math.min(actualMaxPages, totalPages)} pages - Total: ${products.length} products`);
    }

    return {
      success: true,
      products: products,
      totalProducts: totalCount,
      actualFetched: products.length, // Actual count fetched (may differ from total)
      currentPage: pageNum,
      totalPages: totalPages,
      maxFetchablePages: Math.floor(MAX_OFFSET / apiPageSize),
      fetchedPages: fetchAllPages ? Math.min(totalPages, Math.floor(MAX_OFFSET / apiPageSize)) : 1,
      scrapeId: options.scrapeId || null
    };

  } catch (error) {
    console.error('[CJ API] Error:', error.message);

    if (error.response) {
      console.error('[CJ API] Response status:', error.response.status);
      console.error('[CJ API] Response data:', JSON.stringify(error.response.data));
    }

    return {
      success: false,
      error: error.message,
      products: [],
      totalProducts: 0
    };
  }
}

/**
 * Get CJ product categories
 * Useful for finding category IDs to use in product search
 * @param {string} cjToken - CJ API token
 */
async function getCJCategories(cjToken) {
  try {
    console.log('[CJ API] Fetching category list...');

    const response = await axios.get(`${CJ_API_BASE}/product/getCategory`, {
      headers: {
        'CJ-Access-Token': cjToken,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });

    if (response.data.code !== 200) {
      throw new Error(`CJ API Error: ${response.data.message || 'Unknown error'}`);
    }

    const categories = response.data.data || [];
    console.log(`[CJ API] Retrieved ${categories.length} top-level categories`);

    // Flatten the category tree for easier searching
    const flatCategories = [];

    categories.forEach(cat1 => {
      const cat1Info = {
        level: 1,
        name: cat1.categoryFirstName,
        id: null
      };

      if (cat1.categoryFirstList) {
        cat1.categoryFirstList.forEach(cat2 => {
          const cat2Info = {
            level: 2,
            parentName: cat1.categoryFirstName,
            name: cat2.categorySecondName,
            id: null
          };

          if (cat2.categorySecondList) {
            cat2.categorySecondList.forEach(cat3 => {
              flatCategories.push({
                level: 3,
                parentName: `${cat1.categoryFirstName} > ${cat2.categorySecondName}`,
                name: cat3.categoryName,
                id: cat3.categoryId,
                fullPath: `${cat1.categoryFirstName} > ${cat2.categorySecondName} > ${cat3.categoryName}`
              });
            });
          }
        });
      }
    });

    return {
      success: true,
      categories: flatCategories,
      raw: categories
    };

  } catch (error) {
    console.error('[CJ API] Error fetching categories:', error.message);
    return {
      success: false,
      error: error.message,
      categories: []
    };
  }
}

module.exports = {
  searchCJProducts,
  getCJCategories,
  cancelScrape,
  generateScrapeId,
  MAX_OFFSET
};
