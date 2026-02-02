/**
 * CJ Category Service
 * Fetches and caches CJ Dropshipping category hierarchy
 * Used for pre-filtering products by category before Vision API
 */

const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

const CJ_API_BASE = 'https://developers.cjdropshipping.com/api2.0/v1';
const CACHE_DIR = path.join(__dirname, 'cache');
const CACHE_FILE = path.join(CACHE_DIR, 'cj-categories.json');
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Fetch category tree from CJ API
 * @param {string} cjToken - CJ API access token
 * @returns {Promise<Array>} Raw category tree from CJ
 */
async function fetchCategoriesFromAPI(cjToken) {
    console.log('[Category Service] Fetching categories from CJ API...');

    const response = await axios.get(`${CJ_API_BASE}/product/getCategory`, {
        headers: {
            'CJ-Access-Token': cjToken,
            'Content-Type': 'application/json'
        },
        timeout: 30000
    });

    if (response.data.code !== 200) {
        throw new Error(`CJ API Error: ${response.data.message}`);
    }

    console.log(`[Category Service] Retrieved ${response.data.data.length} top-level categories`);
    return response.data.data;
}

/**
 * Build searchable category index from raw category tree
 * Creates a flat index with all Level 3 categories searchable by name
 * @param {Array} categories - Raw category tree from CJ API
 * @returns {Object} Searchable index { categoryName: { id, fullPath, level1, level2, level3 } }
 */
function buildCategoryIndex(categories) {
    const index = {};
    let totalCategories = 0;

    for (const level1 of categories) {
        if (!level1.categoryFirstList) continue;

        for (const level2 of level1.categoryFirstList) {
            if (!level2.categorySecondList) continue;

            for (const level3 of level2.categorySecondList) {
                const key = level3.categoryName.toLowerCase().trim();

                index[key] = {
                    categoryId: level3.categoryId,
                    fullPath: `${level1.categoryFirstName} > ${level2.categorySecondName} > ${level3.categoryName}`,
                    level1: level1.categoryFirstName,
                    level2: level2.categorySecondName,
                    level3: level3.categoryName
                };
                totalCategories++;
            }
        }
    }

    console.log(`[Category Service] Built index with ${totalCategories} searchable categories`);
    return index;
}

/**
 * Get cached categories if available and not expired
 * @returns {Promise<Object|null>} Cached data or null if expired/missing
 */
async function getCachedCategories() {
    try {
        const stats = await fs.stat(CACHE_FILE);
        const age = Date.now() - stats.mtimeMs;

        if (age < CACHE_DURATION) {
            const data = await fs.readFile(CACHE_FILE, 'utf8');
            const parsed = JSON.parse(data);
            console.log(`[Category Service] Using cached categories (${Math.round(age / 1000 / 60)} min old)`);
            return parsed;
        }
        console.log('[Category Service] Cache expired');
    } catch (err) {
        // Cache doesn't exist or is invalid
    }
    return null;
}

/**
 * Save categories to cache
 * @param {Object} data - Category data to cache { raw, index }
 */
async function cacheCategories(data) {
    try {
        await fs.mkdir(CACHE_DIR, { recursive: true });
        await fs.writeFile(CACHE_FILE, JSON.stringify(data, null, 2));
        console.log('[Category Service] Categories cached successfully');
    } catch (err) {
        console.error('[Category Service] Failed to cache categories:', err.message);
    }
}

/**
 * Get category index (from cache or API)
 * @param {string} cjToken - CJ API access token
 * @returns {Promise<Object>} { raw: Array, index: Object }
 */
async function getCategoryIndex(cjToken) {
    // Try cache first
    const cached = await getCachedCategories();
    if (cached) {
        return cached;
    }

    // Fetch from API
    const raw = await fetchCategoriesFromAPI(cjToken);
    const index = buildCategoryIndex(raw);

    const data = { raw, index, fetchedAt: new Date().toISOString() };
    await cacheCategories(data);

    return data;
}

/**
 * Search for categories matching a keyword
 * @param {Object} index - Category index from getCategoryIndex()
 * @param {string} keyword - Search keyword
 * @returns {Array} Matching categories sorted by relevance
 */
function searchCategories(index, keyword) {
    const keywordLower = keyword.toLowerCase().trim();
    const matches = [];

    for (const [name, data] of Object.entries(index)) {
        // Exact match
        if (name === keywordLower) {
            matches.push({ ...data, score: 100, matchType: 'exact' });
            continue;
        }

        // Contains keyword
        if (name.includes(keywordLower)) {
            matches.push({ ...data, score: 80, matchType: 'contains' });
            continue;
        }

        // Keyword contains category name
        if (keywordLower.includes(name)) {
            matches.push({ ...data, score: 60, matchType: 'reverse' });
            continue;
        }

        // Word overlap
        const nameWords = name.split(/[\s&]+/);
        const keywordWords = keywordLower.split(/[\s&]+/);
        const overlap = nameWords.filter(w => keywordWords.some(k => k.includes(w) || w.includes(k)));

        if (overlap.length > 0) {
            matches.push({ ...data, score: 40 * overlap.length, matchType: 'word_overlap' });
        }
    }

    // Sort by score descending
    return matches.sort((a, b) => b.score - a.score);
}

/**
 * Get all category names for AI prompt
 * @param {Object} index - Category index
 * @returns {string} Comma-separated list of category names
 */
function getCategoryNames(index) {
    return Object.keys(index).join(', ');
}

// Test function
async function test(cjToken) {
    console.log('=== Category Service Test ===\n');

    const { index } = await getCategoryIndex(cjToken);

    const testSearches = ['throw', 'blanket', 'pillow', 'dog', 'phone'];

    for (const keyword of testSearches) {
        console.log(`\nSearch: "${keyword}"`);
        const results = searchCategories(index, keyword);
        console.log(`Found ${results.length} matches:`);
        results.slice(0, 3).forEach(r => {
            console.log(`  - ${r.level3} (score: ${r.score}, type: ${r.matchType})`);
            console.log(`    ID: ${r.categoryId}`);
        });
    }
}

module.exports = {
    fetchCategoriesFromAPI,
    buildCategoryIndex,
    getCategoryIndex,
    searchCategories,
    getCategoryNames,
    test
};
