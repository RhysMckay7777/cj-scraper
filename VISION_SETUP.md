# Google Vision API Setup (API Key Method)

## Super Simple Setup (5 minutes)

### 1. Enable Vision API

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project (or select existing)
3. Enable **Cloud Vision API**:
   - Go to "APIs & Services" → "Library"
   - Search for "Cloud Vision API"
   - Click "Enable"

### 2. Create API Key

1. Go to "APIs & Services" → "Credentials"
2. Click "Create Credentials" → "API Key"
3. Copy the API key (looks like: `AIzaSyD...`)
4. **IMPORTANT:** Click "Restrict Key":
   - Under "API restrictions" → Select "Restrict key"
   - Choose **"Cloud Vision API"** only
   - Save

### 3. Add to Railway

1. In Railway dashboard, go to your project
2. Click "Variables" tab
3. Add new variable:
   - **Key:** `GOOGLE_VISION_API_KEY`
   - **Value:** `5f85b14f0059fd36e7cdb9c5bfe3743cd25eb54d` (or your API key)
4. Redeploy (Railway will auto-restart)

### 4. Test

Your scraper will now analyze product images automatically!

Check the logs to see:
```
Vision API labels for [image]: textile, blanket, fabric
  ✅ Image passed: valid category
```

## Pricing

- **First 1,000 images/month:** FREE
- **After 1,000:** $1.50 per 1,000 images
- **Your typical search (117 products):** ~$0.18 if over free tier

## Disable Image Detection (Optional)

If you want text-only filtering (no Vision API):

Set environment variable:
- **Key:** `GOOGLE_VISION_API_KEY`
- **Value:** (leave empty or remove)

The scraper will skip image detection and only use text filtering.

## Troubleshooting

**Error: "API key not configured"**
→ Add `GOOGLE_VISION_API_KEY` to Railway environment variables

**Error: "API key restrictions"**
→ Make sure Cloud Vision API is enabled for your key

**Slow scraping:**
→ Normal - Vision API adds ~500ms per image
→ For 100 products = ~50 seconds extra
