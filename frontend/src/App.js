import React, { useState } from 'react';
import axios from 'axios';
import './App.css';
import BatchSearch from './BatchSearch';

// API URL - uses env var in production, proxy in development
const API_URL = process.env.REACT_APP_API_URL || '';

function App() {
  const [activeTab, setActiveTab] = useState('single'); // 'single' or 'batch'
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  
  // Shopify settings
  const [shopifyStore, setShopifyStore] = useState(localStorage.getItem('shopifyStore') || '');
  const [shopifyToken, setShopifyToken] = useState(localStorage.getItem('shopifyToken') || '');
  const [showSettings, setShowSettings] = useState(false);

  const saveShopifySettings = () => {
    localStorage.setItem('shopifyStore', shopifyStore);
    localStorage.setItem('shopifyToken', shopifyToken);
    setShowSettings(false);
    alert('Shopify store settings saved! You can now upload products directly to Shopify.');
  };

  const handleScrape = async (e) => {
    e.preventDefault();

    if (!searchTerm.trim()) {
      setError('Please enter a search term');
      return;
    }

    setLoading(true);
    setError(null);
    setResults(null);

    try {
      const response = await axios.post(`${API_URL}/api/scrape`, {
        searchTerm: searchTerm.trim(),
        options: {}
      });

      setResults(response.data);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Scraping failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>🔍 CJDropshipping Smart Scraper</h1>
        <p>AI-powered product filtering for accurate results</p>
        
        <div className="tabs">
          <button 
            className={`tab ${activeTab === 'single' ? 'active' : ''}`}
            onClick={() => setActiveTab('single')}
          >
            🔍 Single Search
          </button>
          <button 
            className={`tab ${activeTab === 'batch' ? 'active' : ''}`}
            onClick={() => setActiveTab('batch')}
          >
            📦 Batch Search
          </button>
        </div>
        
        <button className="settings-btn" onClick={() => setShowSettings(!showSettings)}>
          ⚙️ {shopifyStore ? `Store: ${shopifyStore.split('.')[0]}` : 'Configure Shopify'}
        </button>
      </header>

      {/* Settings Modal */}
      {showSettings && (
        <div className="settings-modal" onClick={() => setShowSettings(false)}>
          <div className="settings-content" onClick={(e) => e.stopPropagation()}>
            <h2>⚙️ Shopify Store Settings</h2>
            <p>Configure which Shopify store to upload products to</p>
            
            <div className="settings-form">
              <div className="form-group">
                <label>Shopify Store URL</label>
                <input
                  type="text"
                  value={shopifyStore}
                  onChange={(e) => setShopifyStore(e.target.value)}
                  placeholder="your-store.myshopify.com"
                  className="settings-input"
                />
                <small>Format: your-store.myshopify.com (no https://)</small>
              </div>

              <div className="form-group">
                <label>Shopify Admin API Token</label>
                <input
                  type="password"
                  value={shopifyToken}
                  onChange={(e) => setShopifyToken(e.target.value)}
                  placeholder="shpat_xxxxxxxxxxxxx"
                  className="settings-input"
                />
                <small>Get from: Shopify Admin → Apps → Develop apps</small>
              </div>

              <div className="settings-actions">
                <button onClick={() => setShowSettings(false)} className="btn-cancel">
                  Cancel
                </button>
                <button onClick={saveShopifySettings} className="btn-save">
                  Save Settings
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="container">
        {activeTab === 'batch' ? (
          <BatchSearch shopifyStore={shopifyStore} shopifyToken={shopifyToken} />
        ) : (
          <>
        <form onSubmit={handleScrape} className="search-form">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Enter product search term (e.g., sherpa blanket)"
            className="search-input"
            disabled={loading}
          />
          <button type="submit" disabled={loading} className="search-button">
            {loading ? 'Scraping...' : 'Search'}
          </button>
        </form>

        {error && (
          <div className="error">
            ❌ {error}
          </div>
        )}

        {results && (
          <div className="results">
            <div className="stats">
              <div className="stat">
                <span className="stat-label">Search Term:</span>
                <span className="stat-value">{results.searchTerm}</span>
              </div>
              <div className="stat">
                <span className="stat-label">Total Found:</span>
                <span className="stat-value">{results.totalFound}</span>
              </div>
              <div className="stat">
                <span className="stat-label">Passed Filter:</span>
                <span className="stat-value">{results.filtered}</span>
              </div>
              <div className="stat">
                <span className="stat-label">Pass Rate:</span>
                <span className="stat-value">{results.passRate}</span>
              </div>
            </div>

            {results.products && results.products.length > 0 ? (
              <div className="products">
                <h2>✅ Relevant Products ({results.filtered})</h2>
                <div className="product-grid">
                  {results.products.map((product, idx) => (
                    <div key={idx} className="product-card">
                      <h3>{product.title}</h3>
                      <div className="product-info">
                        <span className="price">{product.price}</span>
                        <span className="lists">Lists: {product.lists}</span>
                      </div>
                      <a
                        href={product.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="product-link"
                      >
                        View Product →
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="no-results">
                <p>No relevant products found matching "{results.searchTerm}"</p>
                <p>Try adjusting your search term or removing filters</p>
              </div>
            )}
          </div>
        )}
        </>
        )}
      </div>
    </div>
  );
}

export default App;
