FROM node:20-alpine

# Install FFmpeg for video processing
RUN apk add --no-cache ffmpeg

WORKDIR /app

# Copy package.json & install
COPY package*.json ./
RUN npm install

# Copy source code
COPY . .

# Build NestJS
RUN npm run build

EXPOSE 5000

CMD ["node", "dist/main.js"]
