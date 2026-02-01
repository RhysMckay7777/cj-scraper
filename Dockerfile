# Use official Node image with Puppeteer pre-installed
FROM ghcr.io/puppeteer/puppeteer:21.6.1

# Set working directory
WORKDIR /app

# Copy package files
COPY backend/package*.json ./backend/
COPY frontend/package*.json ./frontend/

# Install backend dependencies
WORKDIR /app/backend
RUN npm install --production

# Install frontend dependencies and build
WORKDIR /app/frontend
RUN npm install
RUN npm run build

# Copy application code
WORKDIR /app
COPY . .

# Expose port
ENV PORT=8080
EXPOSE 8080

# Start server
CMD ["node", "backend/server.js"]
