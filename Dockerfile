# Base image
FROM node:20-alpine

# Install ffmpeg
RUN apk add --no-cache ffmpeg

# Set workdir
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install deps
RUN npm install

# Copy source code
COPY . .

# Prisma generate
RUN npx prisma generate

# Expose port
EXPOSE 3000

# Run app
CMD ["npm", "run", "start:dev"]
