import React, { useState } from 'react';
import axios from 'axios';
import './BatchSearch.css';

// API URL - uses env var in production, proxy in development
// Ensure the URL has a protocol (https://) to avoid relative path issues
const rawApiUrl = process.env.REACT_APP_API_URL || '';
const API_URL = rawApiUrl && !rawApiUrl.startsWith('http')
  ? `https://${rawApiUrl}`
  : rawApiUrl;

function BatchSearch({ stores, activeStore, activeStoreId, setActiveStoreId }) {
  const [searches, setSearches] = useState([
    { keyword: '', url: '', enabled: true }
  ]);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [expandedResults, setExpandedResults] = useState({}); // Track which results are expanded
  const [isCancelling, setIsCancelling] = useState(false);
  const [isUploadCancelling, setIsUploadCancelling] = useState(false);

  const addSearch = () => {
    setSearches([...searches, { keyword: '', url: '', enabled: true }]);
  };

  const removeSearch = (index) => {
    setSearches(searches.filter((_, i) => i !== index));
  };

  const toggleExpanded = (index) => {
    setExpandedResults(prev => ({
      ...prev,
      [index]: !prev[index]
    }));
  };

  const updateSearch = (index, field, value) => {
    const updated = [...searches];
    updated[index][field] = value;
    setSearches(updated);
  };

  // Cancel all active scrapes
  const handleCancelScrape = async () => {
    setIsCancelling(true);
    try {
      await axios.post(`${API_URL}/api/scrape/cancel-all`);
      console.log('Scrape cancelled');
      setError('Scrape cancelled by user');
    } catch (err) {
      console.error('Failed to cancel:', err);
    } finally {
      setIsCancelling(false);
      setLoading(false);
    }
  };

  const handleBatchScrape = async (e) => {
    e.preventDefault();

    const activeSearches = searches.filter(s => s.enabled && (s.url.trim() || s.keyword.trim()));

    if (activeSearches.length === 0) {
      setError('Please enter at least one CJ URL');
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

        // Send URL (new backend) + searchTerm extracted (old backend compatibility)
        // Extract search term from URL for backward compatibility
        let searchTerm = '';
        if (search.url.trim()) {
          try {
            const urlMatch = search.url.match(/\/search\/(.+?)\.html/);
            searchTerm = urlMatch ? decodeURIComponent(urlMatch[1]).replace(/\+/g, ' ') : '';
          } catch (e) {
            searchTerm = '';
          }
        }

        const requestBody = search.url.trim()
          ? {
            searchUrl: search.url.trim(),
            searchTerm: searchTerm || 'fleece throw blanket' // Fallback
          }
          : { searchTerm: search.keyword.trim() };

        // Debug logging
        const requestUrl = `${API_URL}/api/scrape`;
        console.log('='.repeat(60));
        console.log('[BatchSearch] Making request:', {
          url: requestUrl,
          method: 'POST',
          body: requestBody,
          searchIndex: i + 1,
          totalSearches: activeSearches.length
        });
        console.log('='.repeat(60));

        try {
          const response = await axios.post(requestUrl, requestBody);

          console.log('[BatchSearch] SUCCESS Response:', {
            status: response.status,
            data: response.data,
            requestId: response.data?.requestId
          });

          batchResults.push({
            keyword: search.keyword,
            url: search.url,
            success: true,
            data: response.data
          });
        } catch (err) {
          // Detailed error logging
          console.error('[BatchSearch] ERROR:', {
            message: err.message,
            status: err.response?.status,
            statusText: err.response?.statusText,
            data: err.response?.data,
            headers: err.response?.headers,
            config: {
              url: err.config?.url,
              method: err.config?.method,
              data: err.config?.data
            }
          });

          batchResults.push({
            keyword: search.keyword || 'URL provided',
            url: search.url,
            success: false,
            error: err.response?.data?.error || `${err.message} (Status: ${err.response?.status || 'unknown'})`
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
      ['Keyword', 'Product Title', 'Price', 'Lists', 'URL']
    ];

    successfulResults.forEach(result => {
      result.data.products.forEach(product => {
        csv.push([
          result.keyword,
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
    if (!activeStore) {
      alert('Please add a Shopify store first (click Settings button in header)');
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
      // Uploading 100 products takes ~1 minute minimum
      // Set timeout to 10 minutes to be safe
      const response = await axios.post(`${API_URL}/api/upload-shopify`, {
        products: allProducts,
        shopifyStore: activeStore.url,
        shopifyToken: activeStore.token,
        markup: 250 // Default 250% markup
      }, {
        timeout: 600000 // 10 minutes timeout for large uploads
      });

      alert(`Successfully uploaded ${response.data.uploaded}/${allProducts.length} products to Shopify!`);
      if (response.data.limitApplied) {
        alert(`Note: ${response.data.limitApplied}`);
      }
    } catch (err) {
      if (err.code === 'ECONNABORTED') {
        setError('Upload timed out - check Shopify for partial uploads');
      } else {
        setError(err.response?.data?.error || err.message);
      }
      alert('Upload issue: ' + (err.response?.data?.error || err.message || 'Check Shopify for results'));
    } finally {
      setUploading(false);
    }
  };

  const handleCancelUpload = async () => {
    setIsUploadCancelling(true);
    try {
      await axios.post(`${API_URL}/api/upload-shopify/cancel-all`);
      console.log('Upload cancelled');
      setError('Upload cancelled by user');
    } catch (err) {
      console.error('Failed to cancel upload:', err);
    } finally {
      setIsUploadCancelling(false);
      setUploading(false);
    }
  };

  return (
    <div className="batch-search">
      <div className="batch-header">
        <h2>📦 Batch Search</h2>
        <p className="batch-instructions">
          <strong>📋 How to use:</strong><br />
          1. Go to CJDropshipping and search for your product<br />
          2. Apply any filters you want (Verified Warehouse, Min Inventory, etc.)<br />
          3. Copy the full URL from your browser<br />
          4. Paste it below → Click "Start Batch Scrape"<br />
          <em>The scraper will find all products from YOUR filtered search only.</em>
        </p>
      </div>

      <form onSubmit={handleBatchScrape} className="batch-form">
        <div className="searches-container">
          <div className="searches-header">
            <span className="col-url">🔗 CJ Search URL (required)</span>
            <span className="col-actions">Actions</span>
          </div>

          {searches.map((search, index) => (
            <div key={index} className="search-row">
              <input
                type="checkbox"
                checked={search.enabled}
                onChange={(e) => updateSearch(index, 'enabled', e.target.checked)}
                className="search-checkbox"
                title="Enable/disable this search"
              />
              <input
                type="text"
                value={search.url}
                onChange={(e) => updateSearch(index, 'url', e.target.value)}
                placeholder="Paste your CJ search URL here (e.g., https://www.cjdropshipping.com/search/fleece+throw+blanket.html?pageNum=1&verifiedWarehouse=1)"
                className="search-url"
                disabled={loading || !search.enabled}
              />
              <button
                type="button"
                onClick={() => removeSearch(index)}
                disabled={loading || searches.length === 1}
                className="remove-btn"
                title="Remove this search"
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
          {loading ? (
            <>
              <button
                type="button"
                onClick={handleCancelScrape}
                disabled={isCancelling}
                className="stop-btn"
              >
                {isCancelling ? '⏳ Cancelling...' : '🛑 Stop Scraping'}
              </button>
              <span className="scraping-status">
                Scraping... ({results.length}/{searches.filter(s => s.enabled && (s.url.trim() || s.keyword.trim())).length})
              </span>
            </>
          ) : (
            <button type="submit" className="batch-submit">
              🚀 Start Batch Scrape
            </button>
          )}
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

                {/* Store selector for upload */}
                <div className="upload-section">
                  {stores.length > 1 && (
                    <select
                      className="upload-store-selector"
                      value={activeStoreId || ''}
                      onChange={(e) => setActiveStoreId(e.target.value)}
                    >
                      {stores.map(store => (
                        <option key={store.id} value={store.id}>
                          {store.name}
                        </option>
                      ))}
                    </select>
                  )}
                  {uploading ? (
                    <button
                      onClick={handleCancelUpload}
                      className="stop-btn"
                      disabled={isUploadCancelling}
                    >
                      {isUploadCancelling ? '⏳ Cancelling...' : '🛑 Stop Upload'}
                    </button>
                  ) : (
                    <button
                      onClick={uploadToShopify}
                      className="shopify-btn"
                      disabled={uploading || !activeStore}
                      title={activeStore ? `Upload to ${activeStore.name}` : 'Add a store first'}
                    >
                      🏪 Upload to {activeStore?.name || 'Shopify'}
                    </button>
                  )}
                </div>
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
                  {(expandedResults[index] ? result.data.products : result.data.products.slice(0, 6)).map((product, pidx) => (
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
                    <button
                      className="more-products-btn"
                      onClick={() => toggleExpanded(index)}
                    >
                      {expandedResults[index]
                        ? '⬆️ Show less'
                        : `⬇️ +${result.data.products.length - 6} more`}
                    </button>
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
