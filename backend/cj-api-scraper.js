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
 * Search CJ products using the V2 API (Elasticsearch-based)
 * 
 * CRITICAL: listV2 uses different param names than legacy /product/list!
 * - page/size (not pageNum/pageSize)
 * - keyWord (not productNameEn)
 * - startWarehouseInventory (not startInventory)
 * 
 * @param {string} searchTerm - Search keyword
 * @param {string} cjToken - CJ API access token
 * @param {Object} options - Search options
 * @returns {Promise<Object>} { success, products, totalProducts, ... }
 */
async function searchCJProducts(searchTerm, cjToken, options = {}) {
  const {
    categoryId = null,           // Single validated third-level category ID
    lv3categoryList = null,      // Array of third-level category IDs
    lv2categoryList = null,      // Array of second-level category IDs
    verifiedWarehouse = null,    // 0/null=All, 1=Verified, 2=Unverified
    startWarehouseInventory = null,
    endWarehouseInventory = null,
    countryCode = null,          // CN, US, GB, etc.
    pageNum = 1,                 // For backwards compatibility, maps to 'page'
    pageSize = 100,              // For backwards compatibility, maps to 'size'
    fetchAllPages = false,
    orderBy = 0,                 // 0=best match, 1=listing count, 2=price
    sort = 'desc',
    scrapeId = null,             // For cancellation support
    _useLegacy = false           // Internal flag to force legacy endpoint
  } = options;

  // Always prefer listV2 unless explicitly using legacy
  const useListV2 = !_useLegacy;

  console.log('[CJ API] Search configuration:', {
    endpoint: useListV2 ? '/product/listV2' : '/product/list',
    searchTerm,
    categoryId: categoryId || 'NONE',
    page: pageNum,
    size: pageSize,
    verifiedWarehouse
  });

  let allProducts = [];
  let currentPage = pageNum;
  let totalRecords = 0;

  // Register scrape session for cancellation
  const sessionId = scrapeId || generateScrapeId();
  if (fetchAllPages) {
    activeScrapes.set(sessionId, { cancelled: false, startedAt: Date.now() });
  }

  try {
    do {
      // Check for cancellation
      if (fetchAllPages && isCancelled(sessionId)) {
        console.log(`[CJ API] ⛔ Scrape cancelled at page ${currentPage}`);
        break;
      }

      const params = new URLSearchParams();

      if (useListV2) {
        // ========================================
        // listV2 parameters (CORRECT per CJ docs)
        // ========================================
        params.append('keyWord', searchTerm);
        params.append('page', currentPage.toString());
        params.append('size', Math.min(pageSize, 100).toString()); // Max 100 for listV2

        // Category filtering (only add if validated)
        if (categoryId) {
          params.append('categoryId', categoryId);
          console.log('[CJ API] ✓ Applying categoryId filter:', categoryId);
        }

        // Array category filters (if provided)
        if (lv3categoryList && lv3categoryList.length > 0) {
          lv3categoryList.forEach(id => params.append('lv3categoryList', id));
        }
        if (lv2categoryList && lv2categoryList.length > 0) {
          lv2categoryList.forEach(id => params.append('lv2categoryList', id));
        }

        // Warehouse filtering
        if (verifiedWarehouse !== null && verifiedWarehouse !== undefined) {
          params.append('verifiedWarehouse', verifiedWarehouse.toString());
        }

        // Inventory filtering (listV2 uses full names)
        if (startWarehouseInventory !== null) {
          params.append('startWarehouseInventory', startWarehouseInventory.toString());
        }
        if (endWarehouseInventory !== null) {
          params.append('endWarehouseInventory', endWarehouseInventory.toString());
        }

        // Country and sorting
        if (countryCode) {
          params.append('countryCode', countryCode);
        }
        params.append('orderBy', orderBy.toString());
        params.append('sort', sort);

      } else {
        // ========================================
        // Legacy /product/list parameters
        // ========================================
        params.append('productNameEn', searchTerm);
        params.append('pageNum', currentPage.toString());
        params.append('pageSize', Math.min(pageSize, 200).toString()); // Max 200 for legacy

        if (categoryId) {
          params.append('categoryId', categoryId);
        }
        if (verifiedWarehouse !== null && verifiedWarehouse !== undefined) {
          params.append('verifiedWarehouse', verifiedWarehouse.toString());
        }
        // Legacy uses shorter param names
        if (startWarehouseInventory !== null) {
          params.append('startInventory', startWarehouseInventory.toString());
        }
        if (endWarehouseInventory !== null) {
          params.append('endInventory', endWarehouseInventory.toString());
        }
      }

      const endpoint = useListV2 ? '/product/listV2' : '/product/list';
      const url = `${CJ_API_BASE}${endpoint}?${params.toString()}`;

      console.log('[CJ API] Request URL:', url.substring(0, 180) + '...');

      const response = await axios.get(url, {
        headers: {
          'CJ-Access-Token': cjToken,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });

      // Log response
      console.log('[CJ API] Response:', {
        code: response.data.code,
        message: response.data.message
      });

      // Check for API errors
      if (response.data.code !== 200) {
        console.error('[CJ API] Error response:', {
          code: response.data.code,
          message: response.data.message
        });
        throw new Error(`CJ API Error: ${response.data.message} (code: ${response.data.code})`);
      }

      // ========================================
      // PARSE RESPONSE - Different structure for listV2 vs list
      // ========================================
      let products = [];
      let actualPageSize = pageSize;

      if (useListV2) {
        // listV2 response: { totalRecords, totalPages, content: [{ productList: [...] }] }
        totalRecords = response.data.data?.totalRecords || 0;
        actualPageSize = Math.min(pageSize, 100);
        const content = response.data.data?.content || [];

        // Products are nested inside content[].productList
        for (const item of content) {
          if (item.productList && Array.isArray(item.productList)) {
            products.push(...item.productList);
          }
        }

        console.log('[CJ API] listV2 Response:', {
          page: currentPage,
          totalRecords,
          totalPages: response.data.data?.totalPages || 0,
          contentItems: content.length,
          productsExtracted: products.length
        });

      } else {
        // Legacy list response: { total, list: [...], pageNum, pageSize }
        totalRecords = response.data.data?.total || 0;
        products = response.data.data?.list || [];
        actualPageSize = response.data.data?.pageSize || pageSize;

        console.log('[CJ API] list Response:', {
          page: currentPage,
          total: totalRecords,
          returnedProducts: products.length
        });
      }

      // Helper function to generate URL slug
      const generateSlug = (name) => {
        return (name || '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '');
      };

      // Normalize product structure (listV2 uses different field names!)
      const normalizedProducts = products.map(p => {
        // listV2 uses: id, nameEn, sku, bigImage
        // Legacy uses: pid, productNameEn, productSku, productImage
        const productName = p.nameEn || p.productNameEn || '';
        const slug = generateSlug(productName);
        const productId = p.id || p.pid || '';

        return {
          pid: productId,
          title: productName,
          productNameEn: productName,
          productSku: p.sku || p.productSku || '',
          sku: p.sku || p.productSku || '',
          productImage: p.bigImage || p.productImage || '',
          image: p.bigImage || p.productImage || '',
          sellPrice: parseFloat(p.sellPrice) || 0,
          price: `$${parseFloat(p.sellPrice) || 0}`,
          categoryId: p.categoryId || '',
          categoryName: p.threeCategoryName || p.categoryName || '',
          warehouseInventoryNum: p.warehouseInventoryNum || 0,
          verifiedWarehouse: p.verifiedWarehouse,
          listedNum: p.listedNum || 0,
          lists: p.listedNum || 0,
          url: `https://cjdropshipping.com/product/${slug}-p-${productId}.html`,
          variants: p.variants || []
        };
      });

      allProducts.push(...normalizedProducts);
      currentPage++;

      // Stop conditions
      const totalPages = Math.ceil(totalRecords / actualPageSize);
      const maxFetchablePages = Math.floor(MAX_OFFSET / actualPageSize);

      if (!fetchAllPages) {
        break;
      }

      if (currentPage > Math.min(totalPages, maxFetchablePages, useListV2 ? 1000 : 9999)) {
        console.log(`[CJ API] Reached max pages (${currentPage - 1})`);
        break;
      }

      if (products.length === 0) {
        console.log('[CJ API] No more products returned');
        break;
      }

      // Rate limiting delay between pages
      await new Promise(resolve => setTimeout(resolve, 150));

      console.log(`[CJ API] Fetched page ${currentPage - 1}, total so far: ${allProducts.length}`);

    } while (fetchAllPages);

    // Cleanup session
    if (fetchAllPages) {
      activeScrapes.delete(sessionId);
    }

    console.log('[CJ API] ✅ Search complete:', {
      totalRecords,
      fetchedProducts: allProducts.length,
      categoryFilterApplied: !!categoryId
    });

    return {
      success: true,
      products: allProducts,
      totalProducts: totalRecords,
      actualFetched: allProducts.length,
      currentPage: pageNum,
      totalPages: Math.ceil(totalRecords / (useListV2 ? 100 : 200)),
      scrapeId: sessionId
    };

  } catch (error) {
    console.error('[CJ API] Request failed:', error.message);

    // Cleanup session on error
    if (fetchAllPages) {
      activeScrapes.delete(sessionId);
    }

    // If listV2 fails with param error, try legacy endpoint
    if (useListV2 && error.message && error.message.includes('Param error')) {
      console.log('[CJ API] Retrying with legacy /product/list endpoint...');
      return searchCJProducts(searchTerm, cjToken, {
        ...options,
        _useLegacy: true
      });
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
      if (cat1.categoryFirstList) {
        cat1.categoryFirstList.forEach(cat2 => {
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
  MAX_OFFSET,
  CJ_API_BASE
};
