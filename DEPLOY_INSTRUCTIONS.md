# Deploy CJ Scraper to Railway

## ✅ Everything is Ready!

Follow these 3 simple steps to deploy:

## Step 1: Deploy to Railway

**Click this link:**  
https://railway.app/new/template?template=https://github.com/RhysMckay7777/cj-scraper

**What happens:**
- Railway connects to your GitHub
- Deploys the app automatically
- Builds React frontend + Express backend + Puppeteer
- Takes ~3 minutes

## Step 2: Add Google Vision Credentials

After deployment starts:

1. **Click on your new project** in Railway
2. **Go to "Variables" tab**
3. **Click "New Variable"**
4. **Add this:**
   - **Key:** `GOOGLE_CREDENTIALS_JSON`
   - **Value:** Copy from the file `google-credentials.json` in this folder

**To get the credentials:**
- Open the file `/Users/rhysmckay/clawd/cj-scraper/google-credentials.json`
- Select all and copy
- Paste as the variable value in Railway

5. **Railway will auto-restart** with image detection enabled!

## Step 3: Get Your URL

After deployment finishes:
1. Go to "Settings" tab
2. Scroll to "Domains"
3. Copy your Railway URL

Should look like: `https://cj-scraper-production.up.railway.app`

## Step 4: Test It!

Open your Railway URL, then test with:
```
https://www.cjdropshipping.com/search/fleece+throw+blanket.html?pageNum=1&verifiedWarehouse=1
```

**Expected results:**
- Scrapes ONLY from your filtered search
- Text filter: 117 → ~100 products
- Image detection: 100 → ~95 products
- Final: Only actual fleece throw blankets

## That's It!

The app is fully deployed with:
- ✅ URL parsing (respects all your filters)
- ✅ Text filtering (all keywords must match)
- ✅ Image detection (Google Vision analyzes photos)
- ✅ Strict category blocking (no hoodies, sneakers, watches)

---

**Need help? Send me the Railway URL and I'll verify it's working!**
