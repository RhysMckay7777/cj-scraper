import React, { useState } from 'react';
import axios from 'axios';
import './BatchSearch.css';

// Helper: Parse CJ URL to extract keyword and filters
function parseCJUrl(url) {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    
    // Extract keyword from /search/KEYWORD.html
    const match = pathname.match(/\/search\/(.+?)\.html/);
    const keyword = match ? decodeURIComponent(match[1]) : '';
    
    // Extract filters from query params
    const params = new URLSearchParams(urlObj.search);
    const options = {};
    
    if (params.get('verifiedWarehouse') === '1') {
      options.verifiedWarehouse = true;
    }
    if (params.get('startWarehouseInventory')) {
      options.minInventory = parseInt(params.get('startWarehouseInventory'));
    }
    
    return { keyword, options };
  } catch (e) {
    return { keyword: '', options: {} };
  }
}

function BatchSearch({ shopifyStore, shopifyToken }) {
  const [searches, setSearches] = useState([
    { keyword: '', store: '', url: '', enabled: true }
  ]);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResults, setUploadResults] = useState(null);

  const addSearch = () => {
    setSearches([...searches, { keyword: '', store: '', url: '', enabled: true }]);
  };

  const removeSearch = (index) => {
    setSearches(searches.filter((_, i) => i !== index));
  };

  const updateSearch = (index, field, value) => {
    const updated = [...searches];
    updated[index][field] = value;
    setSearches(updated);
  };

  const handleBatchScrape = async (e) => {
    e.preventDefault();
    
    const activeSearches = searches.filter(s => s.enabled && (s.keyword.trim() || s.url.trim()));
    
    if (activeSearches.length === 0) {
      setError('Please enter at least one search keyword or CJ URL');
      return;
    }

    setLoading(true);
    setError(null);
    setResults([]);

    try {
      // Process each search sequentially
      const batchResults = [];
      
      for (let i = 0; i < activeSearches.length; i++) {
        const search = activeSearches[i];
        
        try {
          // Parse URL if provided, otherwise use keyword
          let searchTerm = search.keyword.trim();
          let options = { store: search.store || undefined };
          
          if (search.url.trim()) {
            const parsed = parseCJUrl(search.url.trim());
            searchTerm = parsed.keyword || searchTerm;
            options = { ...options, ...parsed.options };
          }
          
          const response = await axios.post('/api/scrape', {
            searchTerm,
            options
          });

          batchResults.push({
            keyword: searchTerm,
            store: search.store,
            url: search.url,
            success: true,
            data: response.data
          });
        } catch (err) {
          batchResults.push({
            keyword: search.keyword || 'URL provided',
            store: search.store,
            url: search.url,
            success: false,
            error: err.response?.data?.error || err.message
          });
        }

        // Update progress
        setResults([...batchResults]);
        
        // Small delay between requests to avoid rate limiting
        if (i < activeSearches.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

    } catch (err) {
      setError('Batch scraping failed: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const exportResults = () => {
    const successfulResults = results.filter(r => r.success && r.data.products);
    
    const csv = [
      ['Keyword', 'Store', 'Product Title', 'Price', 'Lists', 'URL']
    ];

    successfulResults.forEach(result => {
      result.data.products.forEach(product => {
        csv.push([
          result.keyword,
          result.store || '',
          product.title,
          product.price,
          product.lists,
          product.url
        ]);
      });
    });

    const csvContent = csv.map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cj-batch-results-${Date.now()}.csv`;
    a.click();
  };

  const uploadToShopify = async () => {
    if (!shopifyStore || !shopifyToken) {
      alert('Please configure your Shopify store first (click Settings button in header)');
      return;
    }

    const successfulResults = results.filter(r => r.success && r.data.products);
    
    if (successfulResults.length === 0) {
      alert('No products to upload. Run a batch search first.');
      return;
    }

    // Collect all products
    const allProducts = [];
    successfulResults.forEach(result => {
      result.data.products.forEach(product => {
        allProducts.push({
          ...product,
          sourceKeyword: result.keyword
        });
      });
    });

    setUploading(true);
    setError(null);

    try {
      const response = await axios.post('/api/upload-shopify', {
        products: allProducts,
        shopifyStore,
        shopifyToken,
        markup: 250 // Default 250% markup
      });

      setUploadResults(response.data);
      alert(`Successfully uploaded ${response.data.uploaded}/${allProducts.length} products to Shopify!`);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      alert('Upload failed: ' + (err.response?.data?.error || err.message));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="batch-search">
      <div className="batch-header">
        <h2>📦 Batch Search</h2>
        <p>Search multiple keywords at once - paste CJ URLs with filters or enter keywords manually</p>
      </div>

      <form onSubmit={handleBatchScrape} className="batch-form">
        <div className="searches-container">
          <div className="searches-header">
            <span className="col-keyword">Keyword/Product</span>
            <span className="col-url">CJ URL (optional)</span>
            <span className="col-store">Store/Brand (optional)</span>
            <span className="col-actions">Actions</span>
          </div>

          {searches.map((search, index) => (
            <div key={index} className="search-row">
              <input
                type="checkbox"
                checked={search.enabled}
                onChange={(e) => updateSearch(index, 'enabled', e.target.checked)}
                className="search-checkbox"
              />
              <input
                type="text"
                value={search.keyword}
                onChange={(e) => updateSearch(index, 'keyword', e.target.value)}
                placeholder="e.g., sherpa blanket"
                className="search-keyword"
                disabled={loading || !search.enabled}
              />
              <input
                type="text"
                value={search.url}
                onChange={(e) => updateSearch(index, 'url', e.target.value)}
                placeholder="https://www.cjdropshipping.com/search/..."
                className="search-url"
                disabled={loading || !search.enabled}
              />
              <input
                type="text"
                value={search.store}
                onChange={(e) => updateSearch(index, 'store', e.target.value)}
                placeholder="e.g., Amazon, Nike"
                className="search-store"
                disabled={loading || !search.enabled}
              />
              <button
                type="button"
                onClick={() => removeSearch(index)}
                disabled={loading || searches.length === 1}
                className="remove-btn"
              >
                ❌
              </button>
            </div>
          ))}
        </div>

        <div className="batch-actions">
          <button type="button" onClick={addSearch} disabled={loading} className="add-btn">
            ➕ Add Search
          </button>
          <button type="submit" disabled={loading} className="batch-submit">
            {loading ? `Scraping... (${results.length}/${searches.filter(s => s.enabled && s.keyword).length})` : '🚀 Start Batch Scrape'}
          </button>
        </div>
      </form>

      {error && (
        <div className="error">
          ❌ {error}
        </div>
      )}

      {results.length > 0 && (
        <div className="batch-results">
          <div className="results-header">
            <h3>📊 Results ({results.filter(r => r.success).length}/{results.length} successful)</h3>
            {results.some(r => r.success) && (
              <div className="results-actions">
                <button onClick={exportResults} className="export-btn">
                  📥 Export CSV
                </button>
                <button 
                  onClick={uploadToShopify} 
                  className="shopify-btn"
                  disabled={uploading}
                >
                  {uploading ? '⏳ Uploading...' : '🏪 Upload to Shopify'}
                </button>
              </div>
            )}
          </div>

          {results.map((result, index) => (
            <div key={index} className={`result-item ${result.success ? 'success' : 'failed'}`}>
              <div className="result-header">
                <h4>
                  {result.success ? '✅' : '❌'} {result.keyword}
                  {result.store && <span className="store-badge">{result.store}</span>}
                </h4>
                {result.success && result.data && (
                  <div className="result-stats">
                    <span>{result.data.filtered} products found</span>
                    <span>{result.data.passRate} pass rate</span>
                  </div>
                )}
              </div>

              {result.success && result.data && result.data.products && result.data.products.length > 0 ? (
                <div className="mini-product-grid">
                  {result.data.products.slice(0, 6).map((product, pidx) => (
                    <div key={pidx} className="mini-product-card">
                      <div className="mini-product-title">{product.title}</div>
                      <div className="mini-product-info">
                        <span className="mini-price">{product.price}</span>
                        <a href={product.url} target="_blank" rel="noopener noreferrer" className="mini-link">
                          View →
                        </a>
                      </div>
                    </div>
                  ))}
                  {result.data.products.length > 6 && (
                    <div className="more-products">
                      +{result.data.products.length - 6} more
                    </div>
                  )}
                </div>
              ) : result.error ? (
                <div className="result-error">
                  {result.error}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default BatchSearch;
