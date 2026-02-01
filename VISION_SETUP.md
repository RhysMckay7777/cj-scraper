# Google Vision API Setup

## 1. Enable Vision API

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project (or select existing)
3. Enable **Cloud Vision API**:
   - Go to "APIs & Services" → "Library"
   - Search for "Cloud Vision API"
   - Click "Enable"

## 2. Create Service Account

1. Go to "IAM & Admin" → "Service Accounts"
2. Click "Create Service Account"
3. Name it: `cj-scraper-vision`
4. Grant role: **Cloud Vision API User**
5. Click "Create Key" → JSON
6. Save the JSON file

## 3. Add to Railway

### Option A: Environment Variable (Recommended)
1. In Railway dashboard, go to your project
2. Click "Variables" tab
3. Add new variable:
   - Key: `GOOGLE_APPLICATION_CREDENTIALS_JSON`
   - Value: Paste the entire contents of your JSON key file

### Option B: Upload Key File
1. Base64 encode your key file:
   ```bash
   cat google-vision-key.json | base64
   ```
2. Add to Railway as environment variable:
   - Key: `GOOGLE_VISION_KEY_BASE64`
   - Value: The base64 string

Then update `backend/server.js` to decode it:
```javascript
if (process.env.GOOGLE_VISION_KEY_BASE64) {
  const keyData = Buffer.from(process.env.GOOGLE_VISION_KEY_BASE64, 'base64').toString();
  fs.writeFileSync('./google-vision-key.json', keyData);
}
```

## 4. Test Locally

```bash
cd backend
export GOOGLE_APPLICATION_CREDENTIALS=./google-vision-key.json
npm install
npm start
```

## 5. Pricing

- **First 1,000 images/month:** FREE
- **After 1,000:** $1.50 per 1,000 images

For 117 products = ~$0.18 per search (if over free tier)

## 6. Disable Image Detection (Optional)

If you want to skip image detection and only use text filtering:

```javascript
// In frontend request
{
  "searchUrl": "...",
  "useImageDetection": false
}
```

This will skip Vision API calls and only use text-based filtering.
