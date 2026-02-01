// Vercel Serverless: Upload CJ Products to Shopify
const axios = require('axios');

async function uploadProductToShopify(product, markup, shopifyConfig) {
  const { store, token } = shopifyConfig;

  // Parse price
  const priceMatch = product.price.match(/[\d.]+/);
  const price = priceMatch ? parseFloat(priceMatch[0]) : 0;
  const sellingPrice = price * (1 + markup / 100);

  const productData = {
    product: {
      title: product.title,
      vendor: 'CJ Dropshipping',
      product_type: 'Imported',
      tags: ['dropship', 'cj', product.sourceKeyword || ''].filter(Boolean),
      variants: [
        {
          price: sellingPrice.toFixed(2),
          compare_at_price: (sellingPrice * 1.3).toFixed(2),
          inventory_management: null,
          inventory_quantity: 999
        }
      ],
      images: product.url ? [{ src: product.url }] : []
    }
  };

  try {
    const response = await axios.post(
      `https://${store}/admin/api/2024-01/products.json`,
      productData,
      {
        headers: {
          'X-Shopify-Access-Token': token,
          'Content-Type': 'application/json'
        }
      }
    );

    return {
      success: true,
      productId: response.data.product.id,
      shopifyUrl: `https://${store}/admin/products/${response.data.product.id}`
    };
  } catch (error) {
    console.error('Shopify upload error:', error.response?.data || error.message);
    throw new Error(error.response?.data?.errors || error.message);
  }
}

// Vercel handler
module.exports = async (req, res) => {
  // ============================================
  // COMPREHENSIVE LOGGING FOR DEBUG
  // ============================================
  const requestId = Date.now().toString(36) + Math.random().toString(36).substr(2);

  console.log('='.repeat(60));
  console.log(`[${requestId}] SHOPIFY UPLOAD REQUEST AT ${new Date().toISOString()}`);
  console.log(`[${requestId}] Method: ${req.method}`);
  console.log(`[${requestId}] URL: ${req.url}`);
  console.log(`[${requestId}] Headers:`, JSON.stringify(req.headers, null, 2));
  console.log(`[${requestId}] Body keys:`, Object.keys(req.body || {}));
  console.log(`[${requestId}] Product count:`, req.body?.products?.length || 0);
  console.log('='.repeat(60));

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    console.log(`[${requestId}] Handling OPTIONS preflight`);
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    console.error(`[${requestId}] ERROR: Method ${req.method} not allowed`);
    return res.status(405).json({
      error: 'Method not allowed',
      receivedMethod: req.method,
      requestId
    });
  }

  const { products, markup = 250, shopifyStore, shopifyToken } = req.body;

  if (!products || !Array.isArray(products) || products.length === 0) {
    return res.status(400).json({ error: 'Products array is required' });
  }

  if (!shopifyStore || !shopifyToken) {
    return res.status(400).json({
      error: 'Shopify credentials required',
      instructions: 'Configure your store in Settings'
    });
  }

  try {
    const results = [];

    // Upload products sequentially to avoid rate limits
    for (const product of products) {
      try {
        const result = await uploadProductToShopify(product, markup, {
          store: shopifyStore,
          token: shopifyToken
        });

        results.push({
          title: product.title,
          ...result
        });

        // Small delay to respect Shopify rate limits (2 calls/second)
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        results.push({
          title: product.title,
          success: false,
          error: error.message
        });
      }
    }

    const successCount = results.filter(r => r.success).length;

    res.status(200).json({
      success: true,
      total: products.length,
      uploaded: successCount,
      failed: products.length - successCount,
      results
    });

  } catch (error) {
    res.status(500).json({
      error: error.message || 'Upload failed'
    });
  }
};
