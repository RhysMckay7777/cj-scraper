const axios = require('axios');

const CJ_API_BASE = 'https://developers.cjdropshipping.com/api2.0/v1';

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
      fetchAllPages = false // NEW: option to fetch all pages
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
    const totalPages = Math.ceil(totalCount / pageSize);

    console.log(`[CJ API] Found ${totalCount} total products across ${totalPages} pages`);
    console.log(`[CJ API] Returned ${productList.length} products on page ${pageNum}`);

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

    // NEW: Fetch all pages if requested
    if (fetchAllPages && totalPages > 1) {
      console.log(`[CJ API] Fetching remaining ${totalPages - 1} pages...`);
      
      for (let page = 2; page <= totalPages; page++) {
        // Add delay to avoid rate limiting (CJ API limit: 1 request per second)
        await new Promise(resolve => setTimeout(resolve, 1100));
        
        const nextPageResult = await searchCJProducts(searchTerm, cjToken, {
          ...options,
          pageNum: page,
          fetchAllPages: false // Don't recurse infinitely
        });
        
        if (nextPageResult.success) {
          products = products.concat(nextPageResult.products);
          console.log(`[CJ API] Fetched page ${page}/${totalPages} - Total products so far: ${products.length}`);
        } else {
          console.error(`[CJ API] Failed to fetch page ${page}: ${nextPageResult.error}`);
        }
      }
      
      console.log(`[CJ API] ✅ Fetched all ${totalPages} pages - Total: ${products.length} products`);
    }

    return {
      success: true,
      products: products,
      totalProducts: totalCount,
      currentPage: pageNum,
      totalPages: totalPages,
      fetchedPages: fetchAllPages ? totalPages : 1
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
  getCJCategories
};
