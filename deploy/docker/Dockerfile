FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --production=false

# Copy app
COPY . .

# Build
RUN npm run build

# Create directories for runtime
RUN mkdir -p pocketbase/pb_data workspace

# Expose port
EXPOSE 3000
ENV PORT=3000
ENV HOST=0.0.0.0

# Make start script executable
COPY deploy/railway/start.sh ./start.sh
RUN chmod +x ./start.sh

# Start
CMD ["./start.sh"]
