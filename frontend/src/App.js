import React, { useState } from 'react';
import axios from 'axios';
import './App.css';

function App() {
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);

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
      const response = await axios.post('/api/scrape', {
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
      </header>

      <div className="container">
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
      </div>
    </div>
  );
}

export default App;
