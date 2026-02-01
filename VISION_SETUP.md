# Google Vision API Setup

## ✅ You Already Have the Service Account!

I can see you have the JSON file. Here's how to use it:

## Railway Setup (2 Steps)

### 1. Deploy to Railway

Click: https://railway.app/new/template?template=https://github.com/RhysMckay7777/cj-scraper

OR manually:
- Go to railway.app
- "New Project" → "Deploy from GitHub"  
- Select `RhysMckay7777/cj-scraper`

### 2. Add Your Service Account JSON

In Railway dashboard:

1. Click your project → **"Variables"** tab
2. Click **"New Variable"**
3. Add:
   - **Key:** `GOOGLE_CREDENTIALS_JSON`
   - **Value:** Paste the entire JSON file contents

**Use the JSON file you downloaded** (the one from Google Cloud Console).

Open the JSON file and copy its ENTIRE contents, then paste as the value.

4. Railway will auto-restart with image detection enabled

## That's It!

Your scraper will now:
1. Scrape products from YOUR filtered CJ URL
2. Filter by text (title must have all keywords)
3. **Analyze each image with Google Vision**
4. Reject products where image doesn't match (watches, toys, etc.)
5. Export only products passing both filters

## Test It

After deployment, test with:
```
https://www.cjdropshipping.com/search/fleece+throw+blanket.html?pageNum=1&verifiedWarehouse=1
```

Expected results:
- Text filter: 117 → ~100 products
- Image filter: 100 → ~95 products  
- Final: Only actual fleece throw blankets

## Pricing

- **First 1,000 images/month:** FREE
- **After 1,000:** $1.50 per 1,000 images
- **Your typical search (117 products):** FREE (under quota)

## Disable Image Detection

To skip Vision API and only use text filtering:

Remove the `GOOGLE_CREDENTIALS_JSON` variable in Railway.
