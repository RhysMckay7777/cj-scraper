# Quick Setup Guide

## 🚀 Get Started in 3 Steps

### 1. Clone & Navigate
```bash
cd cj-scraper
```

### 2. Easy Start (Recommended)
```bash
./start.sh
```

This will:
- Install all dependencies
- Create environment files
- Start backend on port 3001
- Start frontend on port 3000
- Open browser to http://localhost:3000

### 3. Manual Start (Alternative)

**Terminal 1 - Backend:**
```bash
cd backend
npm install
cp .env.example .env
npm start
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm install
npm start
```

## 📤 Deploy to GitHub

```bash
# Create a new repo on GitHub first, then:
git remote add origin https://github.com/YOUR_USERNAME/cj-scraper.git
git push -u origin main
```

## 🧪 Test the Scraper

1. Open http://localhost:3000
2. Enter "sherpa blanket" in the search box
3. Click "Search"
4. Watch it filter out 96% of irrelevant products!

## 📊 Expected Results

**Search: "sherpa blanket"**
- Total Found: ~116 products
- Passed Filter: ~5 products (4.3%)
- Filtered Out: ~111 irrelevant items

The scraper removes:
- ❌ Summer blankets
- ❌ Pet blankets (without sherpa)
- ❌ Beach mats
- ❌ Air conditioning blankets
- ❌ Children's blankets
- ✅ Only keeps actual sherpa blankets

## 🔧 Configuration

### Backend Port
Edit `backend/.env`:
```
PORT=3001
```

### Frontend API URL
Production: Update `frontend/package.json` proxy or use environment variable.

## 🐛 Troubleshooting

**Port already in use:**
```bash
# Find and kill process
lsof -ti:3001 | xargs kill -9  # Backend
lsof -ti:3000 | xargs kill -9  # Frontend
```

**Puppeteer errors:**
```bash
# Install Chrome dependencies (Ubuntu/Debian)
sudo apt-get install -y chromium-browser

# macOS (should work out of the box)
brew install chromium
```

**Module not found:**
```bash
# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
```

## 📝 Notes

- First scrape takes ~5-10 seconds (Puppeteer loading)
- Subsequent scrapes are faster
- CJDropshipping may rate limit - use responsibly
- Results cached in memory (not persistent)

## 🎯 Next Steps

1. Test with different search terms
2. Adjust filtering logic in `backend/server.js`
3. Customize UI in `frontend/src/App.js`
4. Deploy to production (Heroku, Vercel, etc.)

## 💡 Tips

- Search for specific product types for best results
- Generic terms may have more false positives
- Check the pass rate to gauge filter effectiveness
- Tweak `isRelevantProduct()` function for your use case
