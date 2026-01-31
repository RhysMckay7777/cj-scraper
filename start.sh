#!/bin/bash

echo "🚀 Starting CJ Smart Scraper..."

# Install dependencies if not installed
if [ ! -d "backend/node_modules" ]; then
  echo "📦 Installing backend dependencies..."
  cd backend && npm install && cd ..
fi

if [ ! -d "frontend/node_modules" ]; then
  echo "📦 Installing frontend dependencies..."
  cd frontend && npm install && cd ..
fi

# Create .env if it doesn't exist
if [ ! -f "backend/.env" ]; then
  echo "⚙️  Creating backend .env file..."
  cp backend/.env.example backend/.env
fi

# Start backend in background
echo "🔧 Starting backend..."
cd backend && npm start &
BACKEND_PID=$!

# Wait for backend to start
sleep 3

# Start frontend
echo "🎨 Starting frontend..."
cd ../frontend && npm start

# Cleanup on exit
trap "kill $BACKEND_PID" EXIT
