const axios = require('axios');

const CJ_API_BASE = 'https://developers.cjdropshipping.com/api2.0/v1';

/**
 * Search CJ products using their official API
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

    const response = await axios.post(`${CJ_API_BASE}/product/list`, {
      categoryId: '',
      productNameEn: searchTerm,
      pageNum: pageNum,
      pageSize: pageSize,
      ...(verifiedWarehouse ? { verifiedWarehouse: parseInt(verifiedWarehouse) } : {})
    }, {
      headers: {
        'CJ-Access-Token': cjToken,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });

    if (response.data.code !== 200) {
      throw new Error(`CJ API Error: ${response.data.message || 'Unknown error'}`);
    }

    const data = response.data.data;
    
    console.log(`[CJ API] Found ${data.total} total products`);
    console.log(`[CJ API] Returned ${data.list?.length || 0} products on this page`);

    // Transform CJ API response to our format
    const products = (data.list || []).map(product => ({
      title: product.productNameEn || '',
      price: `$${product.sellPrice || 0}`,
      lists: 0, // CJ API doesn't provide this
      url: `https://www.cjdropshipping.com/product/${product.pid}.html`,
      image: product.productImage || '',
      sku: product.productSku || '',
      pid: product.pid || '',
      variants: product.variants || []
    }));

    return {
      success: true,
      products: products,
      totalProducts: data.total || 0,
      currentPage: pageNum,
      totalPages: Math.ceil((data.total || 0) / pageSize)
    };

  } catch (error) {
    console.error('[CJ API] Error:', error.message);
    
    if (error.response) {
      console.error('[CJ API] Response:', error.response.data);
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
