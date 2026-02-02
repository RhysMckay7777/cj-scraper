/**
 * AI Keyword Generator
 * Uses Gemini Flash 2.0 for dynamic keyword generation
 * - Maps search terms to CJ categories
 * - Generates accept/reject labels for Vision API
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs').promises;
const path = require('path');

const CACHE_DIR = path.join(__dirname, 'cache');
const KEYWORD_CACHE_FILE = path.join(CACHE_DIR, 'keyword-mappings.json');

// Initialize Gemini
let genAI = null;
let model = null;

function initGemini(apiKey) {
    if (!genAI && apiKey) {
        genAI = new GoogleGenerativeAI(apiKey);
        model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
        console.log('[AI Generator] Gemini 2.0 Flash initialized');
    }
    return model;
}

/**
 * Map search term to CJ category IDs using AI
 * @param {string} searchTerm - User's search term
 * @param {Object} categoryIndex - Category index from category-service
 * @param {string} geminiKey - Gemini API key
 * @returns {Promise<Object>} { categoryIds: [], confidence: 'high'|'medium'|'low', categories: [] }
 */
async function mapSearchToCategories(searchTerm, categoryIndex, geminiKey) {
    const model = initGemini(geminiKey);

    if (!model) {
        console.log('[AI Generator] No Gemini API key, skipping category mapping');
        return { categoryIds: [], confidence: 'none', categories: [] };
    }

    const categoryNames = Object.keys(categoryIndex).slice(0, 200).join(', '); // Limit for prompt size

    const prompt = `You are a product category classifier for CJ Dropshipping.

User search: "${searchTerm}"

Available categories (partial list):
${categoryNames}

Task: Select the 1-3 MOST SPECIFIC categories that match this search intent.

Rules:
- Be SPECIFIC (e.g., "throws & blankets" not "home textiles")
- Return ONLY category names from the list above
- Prioritize exact product type matches
- Exclude unrelated categories (e.g., for "throw", exclude "pillows")

Return ONLY valid JSON:
{
  "categories": ["category1", "category2"],
  "confidence": "high",
  "reasoning": "brief explanation"
}`;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        // Parse JSON from response
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error('AI did not return valid JSON');
        }

        const parsed = JSON.parse(jsonMatch[0]);

        // Map category names to IDs
        const categoryIds = parsed.categories
            .map(name => categoryIndex[name.toLowerCase().trim()]?.categoryId)
            .filter(Boolean);

        console.log(`[AI Generator] Mapped "${searchTerm}" to categories: ${parsed.categories.join(', ')}`);
        console.log(`[AI Generator] Category IDs: ${categoryIds.join(', ')}`);

        return {
            categoryIds,
            confidence: parsed.confidence || 'medium',
            reasoning: parsed.reasoning,
            categories: parsed.categories
        };
    } catch (error) {
        console.error('[AI Generator] Category mapping error:', error.message);
        return { categoryIds: [], confidence: 'error', categories: [], error: error.message };
    }
}

/**
 * Generate dynamic valid/reject keywords for Vision API
 * @param {string} searchTerm - User's search term
 * @param {string} geminiKey - Gemini API key
 * @returns {Promise<Object>} { valid: [], reject: [], confidence: 'high'|'medium'|'low' }
 */
async function generateDynamicKeywords(searchTerm, geminiKey) {
    // Check cache first
    const cached = await getCachedKeywords(searchTerm);
    if (cached) {
        console.log(`[AI Generator] Using cached keywords for "${searchTerm}"`);
        return cached;
    }

    const model = initGemini(geminiKey);

    if (!model) {
        console.log('[AI Generator] No Gemini API key, using fallback keywords');
        return getFallbackKeywords(searchTerm);
    }

    const prompt = `You are an expert at e-commerce product image classification.

User search: "${searchTerm}"

Generate TWO keyword lists for Google Vision API image filtering:

1. VALID labels (10-15): Labels that indicate this IS the correct product
   - MUST include the product name itself (e.g., "blanket" for blanket search)
   - Include related materials, textures, features
   - Be specific to the search intent

2. REJECT labels (5-10): Labels that indicate this is NOT the correct product
   - NEVER include the product name itself in reject (e.g., don't reject "blanket" when searching for blankets!)
   - Only items that are CLEARLY wrong products
   - Be conservative - only reject obvious false positives

CRITICAL: If searching for "weighted blanket", the word "blanket" should be in VALID, never in REJECT!

Example for "weighted blanket":
- Valid: ["blanket", "weighted", "textile", "bedding", "fabric", "wool", "cotton", "linen", "throw", "quilt"]
- Reject: ["pillow", "cushion", "curtain", "rug", "mat", "towel"]

Return ONLY valid JSON:
{
  "valid": ["label1", "label2", "..."],
  "reject": ["label3", "label4", "..."],
  "confidence": "high"
}`;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        // Parse JSON from response
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error('AI did not return valid JSON');
        }

        const parsed = JSON.parse(jsonMatch[0]);

        // SAFEGUARD: Ensure search term words are NEVER in reject labels
        const searchWords = searchTerm.toLowerCase().split(/[\s+]+/).filter(w => w.length > 2);
        const filteredReject = parsed.reject.filter(label => {
            const lowerLabel = label.toLowerCase();
            // Remove any reject label that contains a search word
            return !searchWords.some(word => lowerLabel.includes(word) || word.includes(lowerLabel));
        });

        console.log(`[AI Generator] Generated keywords for "${searchTerm}":`);
        console.log(`  Valid: ${parsed.valid.join(', ')}`);
        console.log(`  Reject (original): ${parsed.reject.join(', ')}`);
        console.log(`  Reject (filtered): ${filteredReject.join(', ')}`);

        const result_data = {
            valid: parsed.valid,
            reject: filteredReject,  // Use filtered reject list
            confidence: parsed.confidence
        };

        // Cache the result
        await cacheKeywords(searchTerm, result_data);

        return result_data;
    } catch (error) {
        console.error('[AI Generator] Keyword generation error:', error.message);
        return getFallbackKeywords(searchTerm);
    }
}

/**
 * Get fallback keywords when AI is not available
 */
function getFallbackKeywords(searchTerm) {
    const words = searchTerm.toLowerCase().split(/[\s+]+/).filter(w => w.length > 2);

    return {
        valid: words,
        reject: [],
        confidence: 'fallback'
    };
}

/**
 * Get cached keywords for a search term
 */
async function getCachedKeywords(searchTerm) {
    try {
        const data = await fs.readFile(KEYWORD_CACHE_FILE, 'utf8');
        const cache = JSON.parse(data);
        const key = searchTerm.toLowerCase().trim();

        if (cache[key]) {
            return cache[key];
        }
    } catch (err) {
        // Cache doesn't exist
    }
    return null;
}

/**
 * Cache keywords for a search term
 */
async function cacheKeywords(searchTerm, keywords) {
    try {
        await fs.mkdir(CACHE_DIR, { recursive: true });

        let cache = {};
        try {
            const data = await fs.readFile(KEYWORD_CACHE_FILE, 'utf8');
            cache = JSON.parse(data);
        } catch (err) {
            // File doesn't exist, start fresh
        }

        const key = searchTerm.toLowerCase().trim();
        cache[key] = {
            ...keywords,
            cachedAt: new Date().toISOString()
        };

        await fs.writeFile(KEYWORD_CACHE_FILE, JSON.stringify(cache, null, 2));
        console.log(`[AI Generator] Cached keywords for "${searchTerm}"`);
    } catch (err) {
        console.error('[AI Generator] Failed to cache keywords:', err.message);
    }
}

/**
 * Clear keyword cache
 */
async function clearCache() {
    try {
        await fs.unlink(KEYWORD_CACHE_FILE);
        console.log('[AI Generator] Keyword cache cleared');
    } catch (err) {
        // File doesn't exist
    }
}

// Test function
async function test(searchTerm, geminiKey) {
    console.log('=== AI Keyword Generator Test ===\n');

    const keywords = await generateDynamicKeywords(searchTerm, geminiKey);

    console.log('\nResult:');
    console.log(JSON.stringify(keywords, null, 2));

    return keywords;
}

module.exports = {
    initGemini,
    mapSearchToCategories,
    generateDynamicKeywords,
    clearCache,
    test
};
