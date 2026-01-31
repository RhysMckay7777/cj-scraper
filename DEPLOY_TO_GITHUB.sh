#!/bin/bash

echo "🚀 Deploying CJ Scraper to GitHub..."
echo ""
echo "📝 Step 1: Create GitHub repository"
echo "   Go to: https://github.com/new"
echo "   Repository name: cj-scraper"
echo "   Description: AI-powered CJ Dropshipping scraper with smart filtering"
echo "   Public or Private: Your choice"
echo "   ❌ DO NOT initialize with README, .gitignore, or license"
echo ""
read -p "Press Enter after creating the repo on GitHub..."
echo ""
echo "📤 Step 2: Pushing code to GitHub..."

# Push to GitHub
git push -u origin main

if [ $? -eq 0 ]; then
  echo ""
  echo "✅ Successfully deployed to GitHub!"
  echo "🔗 View at: https://github.com/RhysMckay7777/cj-scraper"
  echo ""
  echo "Next steps:"
  echo "  • Clone on any machine: git clone https://github.com/RhysMckay7777/cj-scraper.git"
  echo "  • Share the repo URL with collaborators"
  echo "  • GitHub Actions will run automatically on push"
else
  echo ""
  echo "❌ Push failed. Possible issues:"
  echo "  • Repository doesn't exist yet on GitHub"
  echo "  • No GitHub authentication (run: gh auth login)"
  echo "  • Wrong credentials"
  echo ""
  echo "Manual steps:"
  echo "  1. Go to: https://github.com/new"
  echo "  2. Create repo named: cj-scraper"
  echo "  3. Run: git push -u origin main"
fi
