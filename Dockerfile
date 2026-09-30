FROM node:20-slim

WORKDIR /app

# Install dependencies (including tsx for running server.ts)
COPY package*.json ./
RUN npm install

# Copy application source files
COPY . .

# Build frontend production bundle to dist/
RUN npm run build

# Expose port
EXPOSE 3000

ENV PORT=3000
ENV NODE_ENV=production

# Start full-stack Express server
CMD ["npm", "start"]
