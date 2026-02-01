import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './App.css';
import BatchSearch from './BatchSearch';

// API URL - uses env var in production, proxy in development
const rawApiUrl = process.env.REACT_APP_API_URL || '';
const API_URL = rawApiUrl && !rawApiUrl.startsWith('http')
  ? `https://${rawApiUrl}`
  : rawApiUrl;

// Generate unique ID for stores
const generateStoreId = () => `store_${Date.now()}`;

function App() {
  const [activeTab, setActiveTab] = useState('batch'); // Default to batch
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);

  // Multi-store state
  const [stores, setStores] = useState([]);
  const [activeStoreId, setActiveStoreId] = useState(null);
  const [showSettings, setShowSettings] = useState(false);

  // New store form state
  const [newStoreName, setNewStoreName] = useState('');
  const [newStoreUrl, setNewStoreUrl] = useState('');
  const [newStoreToken, setNewStoreToken] = useState('');

  // Load stores from localStorage on mount
  useEffect(() => {
    try {
      const savedStores = localStorage.getItem('shopifyStores');
      if (savedStores) {
        const parsed = JSON.parse(savedStores);
        setStores(parsed);
        // Set first store as active if none selected
        if (parsed.length > 0 && !activeStoreId) {
          setActiveStoreId(parsed[0].id);
        }
      }
      // Migrate old single-store format
      const oldStore = localStorage.getItem('shopifyStore');
      const oldToken = localStorage.getItem('shopifyToken');
      if (oldStore && oldToken && !savedStores) {
        const migratedStore = {
          id: generateStoreId(),
          name: oldStore.split('.')[0],
          url: oldStore,
          token: oldToken
        };
        setStores([migratedStore]);
        setActiveStoreId(migratedStore.id);
        localStorage.setItem('shopifyStores', JSON.stringify([migratedStore]));
        // Clean up old format
        localStorage.removeItem('shopifyStore');
        localStorage.removeItem('shopifyToken');
      }
    } catch (e) {
      console.error('Error loading stores:', e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run on mount

  // Save stores to localStorage when changed
  useEffect(() => {
    if (stores.length > 0) {
      localStorage.setItem('shopifyStores', JSON.stringify(stores));
    }
  }, [stores]);

  // Get active store object
  const activeStore = stores.find(s => s.id === activeStoreId) || null;

  const addStore = () => {
    if (!newStoreName.trim() || !newStoreUrl.trim() || !newStoreToken.trim()) {
      alert('Please fill in all fields');
      return;
    }

    // Validate URL format
    let cleanUrl = newStoreUrl.trim();
    if (cleanUrl.startsWith('https://')) {
      cleanUrl = cleanUrl.replace('https://', '');
    }
    if (cleanUrl.startsWith('http://')) {
      cleanUrl = cleanUrl.replace('http://', '');
    }

    const newStore = {
      id: generateStoreId(),
      name: newStoreName.trim(),
      url: cleanUrl,
      token: newStoreToken.trim()
    };

    setStores([...stores, newStore]);
    setActiveStoreId(newStore.id);

    // Clear form
    setNewStoreName('');
    setNewStoreUrl('');
    setNewStoreToken('');
  };

  const deleteStore = (storeId) => {
    if (!window.confirm('Delete this store?')) return;

    const updatedStores = stores.filter(s => s.id !== storeId);
    setStores(updatedStores);

    // Update active store if deleted
    if (storeId === activeStoreId) {
      setActiveStoreId(updatedStores.length > 0 ? updatedStores[0].id : null);
    }

    // Update localStorage
    if (updatedStores.length === 0) {
      localStorage.removeItem('shopifyStores');
    }
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

        <div className="header-actions">
          {/* Store selector dropdown */}
          {stores.length > 0 && (
            <select
              className="store-selector"
              value={activeStoreId || ''}
              onChange={(e) => setActiveStoreId(e.target.value)}
            >
              {stores.map(store => (
                <option key={store.id} value={store.id}>
                  🏪 {store.name}
                </option>
              ))}
            </select>
          )}

          <button className="settings-btn" onClick={() => setShowSettings(!showSettings)}>
            ⚙️ {stores.length > 0 ? `${stores.length} Store${stores.length > 1 ? 's' : ''}` : 'Add Store'}
          </button>
        </div>
      </header>

      {/* Settings Modal */}
      {showSettings && (
        <div className="settings-modal" onClick={() => setShowSettings(false)}>
          <div className="settings-content multi-store" onClick={(e) => e.stopPropagation()}>
            <h2>🏪 Manage Shopify Stores</h2>
            <p>Add multiple stores to upload products to different shops</p>

            {/* Existing stores list */}
            {stores.length > 0 && (
              <div className="stores-list">
                <h3>Your Stores ({stores.length})</h3>
                {stores.map(store => (
                  <div key={store.id} className={`store-item ${store.id === activeStoreId ? 'active' : ''}`}>
                    <div className="store-info">
                      <strong>{store.name}</strong>
                      <span>{store.url}</span>
                    </div>
                    <div className="store-actions">
                      {store.id !== activeStoreId && (
                        <button
                          className="btn-select"
                          onClick={() => setActiveStoreId(store.id)}
                        >
                          Select
                        </button>
                      )}
                      {store.id === activeStoreId && (
                        <span className="active-badge">✓ Active</span>
                      )}
                      <button
                        className="btn-delete"
                        onClick={() => deleteStore(store.id)}
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Add new store form */}
            <div className="add-store-form">
              <h3>➕ Add New Store</h3>
              <div className="form-group">
                <label>Store Name</label>
                <input
                  type="text"
                  value={newStoreName}
                  onChange={(e) => setNewStoreName(e.target.value)}
                  placeholder="e.g., Blankets Store"
                  className="settings-input"
                />
              </div>

              <div className="form-group">
                <label>Shopify Store URL</label>
                <input
                  type="text"
                  value={newStoreUrl}
                  onChange={(e) => setNewStoreUrl(e.target.value)}
                  placeholder="your-store.myshopify.com"
                  className="settings-input"
                />
                <small>Format: your-store.myshopify.com (no https://)</small>
              </div>

              <div className="form-group">
                <label>Admin API Token</label>
                <input
                  type="password"
                  value={newStoreToken}
                  onChange={(e) => setNewStoreToken(e.target.value)}
                  placeholder="shpat_xxxxxxxxxxxxx"
                  className="settings-input"
                />
                <small>Get from: Shopify Admin → Apps → Develop apps</small>
              </div>

              <button onClick={addStore} className="btn-add-store">
                ➕ Add Store
              </button>
            </div>

            <div className="settings-actions">
              <button onClick={() => setShowSettings(false)} className="btn-done">
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="container">
        {activeTab === 'batch' ? (
          <BatchSearch
            stores={stores}
            activeStore={activeStore}
            activeStoreId={activeStoreId}
            setActiveStoreId={setActiveStoreId}
          />
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
