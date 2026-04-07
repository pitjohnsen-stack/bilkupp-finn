# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:20-slim AS deps

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:20-slim

# Installer Chromium + avhengigheter
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    xdg-utils \
    --no-install-recommends \
  && rm -rf /var/lib/apt/lists/*

# Fortell puppeteer-core hvor Chromium er
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

WORKDIR /app

# Kopier avhengigheter fra build stage
COPY --from=deps /app/node_modules ./node_modules

# Kopier kildekode
COPY . .

# Cloud Run kjører som non-root
RUN addgroup --system --gid 1001 scanner \
 && adduser  --system --uid 1001 --ingroup scanner scanner \
 && chown -R scanner:scanner /app

USER scanner

# Cloud Run forventer port 8080
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
