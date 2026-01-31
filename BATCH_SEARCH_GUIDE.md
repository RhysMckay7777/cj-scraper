# 📦 Batch Search Feature - Usage Guide

## What It Does

The **Batch Search** feature lets you search multiple keywords/products at once, with optional store/brand filters for each.

Perfect for:
- Searching different products simultaneously
- Comparing products across stores
- Processing bulk product lists
- Saving time on repetitive searches

---

## How to Use

### 1. Access Batch Search

Visit: https://cj-scraper.vercel.app/

Click the **"📦 Batch Search"** tab at the top.

### 2. Add Your Searches

Each row allows you to:
- **Keyword/Product:** The main search term (e.g., "sherpa blanket")
- **Store/Brand:** Optional filter (e.g., "Amazon", "Nike")
- **Checkbox:** Enable/disable this search
- **❌ Button:** Remove this row

**Click "➕ Add Search"** to add more rows.

### 3. Example Searches

| Keyword | Store/Brand |
|---------|------------|
| sherpa blanket | - |
| winter coat | Nike |
| yoga mat | Lululemon |
| phone case | Apple |

### 4. Run Batch Scrape

Click **"🚀 Start Batch Scrape"**

The tool will:
- Process each search sequentially
- Show real-time progress
- Display results for each keyword
- Filter irrelevant products using AI

### 5. Review Results

For each search, you'll see:
- ✅ Success/failure indicator
- Number of products found
- Pass rate (filtering accuracy)
- Top 6 products with details
- Link to view each product

### 6. Export Results

Click **"📥 Export CSV"** to download all results as a spreadsheet.

CSV includes:
- Keyword
- Store/Brand
- Product Title
- Price
- Lists (popularity)
- URL

---

## Tips

**Best Practices:**
- Use specific keywords (e.g., "sherpa blanket" vs "blanket")
- Add store filters when targeting specific brands
- Disable searches you don't need (uncheck the box)
- Export to CSV for further analysis in Excel/Sheets

**Rate Limiting:**
- The tool adds a 1-second delay between searches
- This prevents rate limiting from CJ
- Expect ~1 minute per 60 searches

**Accuracy:**
- AI filtering removes ~80-90% of irrelevant products
- "Sherpa blanket" filters out summer blankets, pet blankets, etc.
- Results are highly relevant to your search term

---

## Live URL

**Deployed:** https://cj-scraper.vercel.app/

**Repo:** https://github.com/RhysMckay7777/cj-scraper

---

## Support

Having issues? Check:
1. Make sure keywords are specific
2. Try without store filters first
3. Check browser console for errors
4. Vercel deployment logs: https://vercel.com/dashboard

---

**That's it!** Start batch scraping multiple products at once. 🚀
