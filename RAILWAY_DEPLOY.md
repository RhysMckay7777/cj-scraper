# Deploy to Railway

## One-Click Deploy

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template?template=https://github.com/RhysMckay7777/cj-scraper)

## Manual Deploy

1. Go to [railway.app](https://railway.app)
2. Click "New Project"
3. Select "Deploy from GitHub repo"
4. Choose `RhysMckay7777/cj-scraper`
5. Railway will auto-detect `railway.json` and deploy

## What Gets Deployed

- **Backend**: Express server with Puppeteer scraping
- **Frontend**: React app (built during deploy)
- **Port**: Auto-assigned by Railway (via `PORT` env var)

## After Deployment

Railway will give you a URL like:
```
https://cj-scraper-production.up.railway.app
```

That's your live app! The URL parsing and filtering will work immediately.

## Verify It Works

Test with this URL:
```
https://www.cjdropshipping.com/search/fleece+throw+blanket.html?pageNum=1&verifiedWarehouse=1
```

Should return ~100-120 products (not 5,316).
