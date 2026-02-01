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

    // Build query parameters for GET request
    const params = new URLSearchParams({
      productNameEn: searchTerm,
      pageNum: pageNum.toString(),
      pageSize: pageSize.toString()
    });

    if (verifiedWarehouse) {
      params.append('verifiedWarehouse', verifiedWarehouse.toString());
    }

    const response = await axios.get(`${CJ_API_BASE}/product/listV2?${params.toString()}`, {
      headers: {
        'CJ-Access-Token': cjToken,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });

    // Log full response for debugging
    console.log('[CJ API] Response code:', response.data.code);
    console.log('[CJ API] Response message:', response.data.message);
    console.log('[CJ API] Response data keys:', Object.keys(response.data.data || {}));
    console.log('[CJ API] Full response data:', JSON.stringify(response.data.data, null, 2).substring(0, 500));

    if (response.data.code !== 200) {
      throw new Error(`CJ API Error: ${response.data.message || 'Unknown error'}`);
    }

    const data = response.data.data;

    // Handle listV2 response structure: content[].productList[]
    let productList = [];
    if (data.content && Array.isArray(data.content)) {
      // Flatten all productList arrays from content
      data.content.forEach(item => {
        if (item.productList && Array.isArray(item.productList)) {
          productList = productList.concat(item.productList);
        }
      });
    } else if (data.list) {
      productList = data.list;
    }

    const totalCount = data.totalRecords || data.total || productList.length;

    console.log(`[CJ API] Found ${totalCount} total products`);
    console.log(`[CJ API] Returned ${productList.length} products on this page`);

    // Transform CJ API response to our format
    // listV2 uses: nameEn, bigImage, id instead of productNameEn, productImage, pid
    const products = productList.map(product => ({
      title: product.nameEn || product.productNameEn || product.productName || '',
      price: `$${product.sellPrice || product.price || 0}`,
      lists: product.listedNum || 0,
      url: `https://www.cjdropshipping.com/product/${product.id || product.pid}.html`,
      image: product.bigImage || product.productImage || product.image || '',
      sku: product.sku || product.productSku || '',
      pid: product.id || product.pid || '',
      variants: product.variants || []
    }));

    return {
      success: true,
      products: products,
      totalProducts: totalCount,
      currentPage: pageNum,
      totalPages: data.totalPages || Math.ceil(totalCount / pageSize)
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
