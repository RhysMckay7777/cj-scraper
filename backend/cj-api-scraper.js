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
      verifiedWarehouse = null
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

    console.log(`[CJ API] Found ${totalCount} total products`);
    console.log(`[CJ API] Returned ${productList.length} products on this page`);

    // Transform CJ API response to our format
    // /product/list uses: productNameEn, productImage, pid, sellPrice
    const products = productList.map(product => ({
      title: product.productNameEn || product.productName || '',
      price: `$${product.sellPrice || 0}`,
      lists: product.listedNum || 0,
      url: `https://www.cjdropshipping.com/product/${product.pid}.html`,
      image: product.productImage || '',
      sku: product.productSku || '',
      pid: product.pid || '',
      categoryId: product.categoryId || '',
      variants: product.variants || []
    }));

    return {
      success: true,
      products: products,
      totalProducts: totalCount,
      currentPage: pageNum,
      totalPages: Math.ceil(totalCount / pageSize)
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

module.exports = {
  searchCJProducts
};
