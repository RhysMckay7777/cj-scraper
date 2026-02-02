/**
 * CJ API Integration Test Script
 * Tests category validation and search functionality
 * 
 * Run with: node test-cj-api.js
 */

require('dotenv').config();
const { searchCJProducts, getCJCategories } = require('./cj-api-scraper');
const { getCategoryIndex, isValidCategoryId, getCategoryById } = require('./category-service');

const CJ_TOKEN = process.env.CJ_API_TOKEN;

if (!CJ_TOKEN) {
    console.error('❌ Missing CJ_API_TOKEN in environment');
    process.exit(1);
}

async function runTests() {
    console.log('==============================================');
    console.log('  CJ API Integration Tests');
    console.log('==============================================\n');

    // Test 1: Fetch categories and build validation index
    console.log('📋 TEST 1: Fetch category tree and build index');
    console.log('---------------------------------------------');

    let categories;
    try {
        categories = await getCategoryIndex(CJ_TOKEN);
        const idCount = categories.allIds?.size || Object.keys(categories.byId || {}).length;
        console.log(`✅ Loaded ${idCount} category IDs\n`);
    } catch (error) {
        console.error('❌ Failed to fetch categories:', error.message);
        return;
    }

    // Get a sample valid level-3 category for testing
    const sampleCategoryId = Object.keys(categories.byId).find(
        id => categories.byId[id].level === 3
    );

    if (sampleCategoryId) {
        const categorySample = categories.byId[sampleCategoryId];
        console.log('📌 Sample category for testing:', {
            id: sampleCategoryId.substring(0, 20) + '...',
            name: categorySample.name,
            path: categorySample.path
        });
        console.log('');
    }

    // Test 2: Search WITHOUT category filter
    console.log('📋 TEST 2: Search without category filter');
    console.log('---------------------------------------------');

    let result1;
    try {
        result1 = await searchCJProducts('blanket', CJ_TOKEN, {
            pageNum: 1,
            pageSize: 20,
            fetchAllPages: false
        });
        console.log(`✅ Found ${result1.totalProducts} total products`);
        console.log(`   Returned ${result1.products.length} products on page 1\n`);
    } catch (error) {
        console.error('❌ Search failed:', error.message);
    }

    // Test 3: Search WITH valid category filter
    console.log('📋 TEST 3: Search WITH category filter');
    console.log('---------------------------------------------');

    if (sampleCategoryId) {
        try {
            const result2 = await searchCJProducts('blanket', CJ_TOKEN, {
                pageNum: 1,
                pageSize: 20,
                categoryId: sampleCategoryId,
                fetchAllPages: false
            });
            console.log(`✅ Found ${result2.totalProducts} products with category filter`);
            console.log(`   (Compare to ${result1?.totalProducts || 'unknown'} without filter)\n`);

            if (result2.totalProducts !== result1?.totalProducts) {
                console.log('   🎉 Category filter is working correctly!\n');
            }
        } catch (error) {
            console.error('❌ Category search failed:', error.message);
        }
    } else {
        console.log('⚠️ Skipped - no valid category ID found\n');
    }

    // Test 4: Validate invalid category ID
    console.log('📋 TEST 4: Invalid category ID validation');
    console.log('---------------------------------------------');

    const fakeId = '00000000-0000-0000-0000-000000000000';
    const isValid = isValidCategoryId(fakeId, categories);
    console.log(`   Testing ID: ${fakeId}`);
    console.log(`   Is valid? ${isValid} (should be false)`);
    console.log(isValid ? '❌ FAIL - should have been invalid' : '✅ Correctly identified as invalid\n');

    // Test 5: Search should work with null category (after validation)
    console.log('📋 TEST 5: Search after invalid category rejected');
    console.log('---------------------------------------------');

    // Simulate the validation flow
    const validatedId = isValidCategoryId(fakeId, categories) ? fakeId : null;
    console.log(`   After validation, categoryId = ${validatedId || 'null (ignored)'}`);

    try {
        const result3 = await searchCJProducts('blanket', CJ_TOKEN, {
            pageNum: 1,
            pageSize: 20,
            categoryId: validatedId, // This will be null
            fetchAllPages: false
        });
        console.log(`✅ Found ${result3.totalProducts} products (invalid ID was correctly ignored)`);
        console.log(`   Search still works when category is invalid!\n`);
    } catch (error) {
        console.error('❌ Search failed:', error.message);
    }

    // Test 6: Verify listV2 parameters
    console.log('📋 TEST 6: Verify listV2 endpoint response');
    console.log('---------------------------------------------');

    try {
        const result = await searchCJProducts('hoodie', CJ_TOKEN, {
            pageNum: 1,
            pageSize: 10,
            verifiedWarehouse: 1,
            fetchAllPages: false
        });

        if (result.products.length > 0) {
            const sample = result.products[0];
            console.log('✅ Sample product from listV2:');
            console.log(`   - Title: ${sample.title?.substring(0, 40)}...`);
            console.log(`   - Price: ${sample.price}`);
            console.log(`   - Category: ${sample.categoryName || 'N/A'}`);
            console.log(`   - Image: ${sample.image?.substring(0, 50)}...`);
            console.log(`   - URL: ${sample.url?.substring(0, 60)}...`);
        }
    } catch (error) {
        console.error('❌ listV2 test failed:', error.message);
    }

    console.log('\n==============================================');
    console.log('  All Tests Complete');
    console.log('==============================================');
}

runTests().catch(error => {
    console.error('❌ Test script failed:', error);
    process.exit(1);
});
