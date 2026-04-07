FROM node:20-slim

# Google Chrome (apt-key er utdatert på Debian bookworm — bruk signed-by)
RUN apt-get update \
    && apt-get install -y wget gnupg ca-certificates --no-install-recommends \
    && wget -q -O- https://dl.google.com/linux/linux_signing_key.pub \
        | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg \
    && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" \
       > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update \
    && apt-get install -y google-chrome-stable --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY . .

RUN addgroup --system --gid 1001 scanner \
 && adduser  --system --uid 1001 --ingroup scanner scanner \
 && chown -R scanner:scanner /app

USER scanner

ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
