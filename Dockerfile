FROM node:20-alpine AS builder

RUN apk add --no-cache ffmpeg bash openssl
WORKDIR /app

COPY package*.json ./
RUN npm install --legacy-peer-deps

COPY . .
RUN npx prisma generate
RUN npm run build


# ================== RUNTIME ==================
FROM node:20-alpine

# INSTALL FFMPEG HERE (THIS IS THE FIX)
RUN apk add --no-cache ffmpeg bash openssl

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/prisma ./prisma

EXPOSE 5000 8001 1935

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
