FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --ignore-scripts=false
COPY tsconfig*.json vite.config.ts vitest.config.ts eslint.config.js ./
COPY src ./src
COPY web ./web
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 APP_DATA_DIR=/app/data DATABASE_PATH=/app/data/weggeefkastjes.sqlite WEB_DIST_PATH=/app/dist-web ALLOW_NETWORK_BINDING=true
WORKDIR /app
RUN useradd --system --uid 10001 --create-home appuser
COPY --from=build --chown=appuser:appuser /app/node_modules ./node_modules
COPY --from=build --chown=appuser:appuser /app/dist ./dist
COPY --from=build --chown=appuser:appuser /app/dist-web ./dist-web
COPY --from=build --chown=appuser:appuser /app/package.json ./package.json
RUN mkdir -p /app/data && chown appuser:appuser /app/data
USER appuser
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server-main.js"]
