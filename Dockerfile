FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --no-audit --no-fund

FROM dependencies AS backend-build
COPY tsconfig.server.json ./
COPY prisma ./prisma
COPY server ./server
COPY shared ./shared
RUN npm run build:server && npm prune --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim AS backend
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=backend-build --chown=node:node /app/node_modules ./node_modules
COPY --from=backend-build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
COPY --chown=node:node prisma ./prisma
COPY --chown=node:node prompts ./prompts
USER node
EXPOSE 3181
CMD ["node", "dist/server/main.js"]

FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS frontend-build
WORKDIR /app
ENV PRISMA_SKIP_POSTINSTALL_GENERATE=true
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY vite.config.ts ./
COPY web ./web
COPY shared ./shared
RUN npm run build:web

FROM nginx:1.28-alpine AS frontend
COPY ops/nginx.conf /etc/nginx/nginx.conf
COPY --from=frontend-build /app/dist-web /usr/share/nginx/html
USER nginx
EXPOSE 8080
ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]

# DCC installs one image. The Compose targets above remain available for split services.
FROM postgres:17-bookworm AS standalone
WORKDIR /app
ENV NODE_ENV=production \
    XC_STATE_DIR=/var/lib/postgresql/data \
    PUBLIC_ORIGIN=http://localhost:3180 \
    SIWC_CALLBACK_ORIGIN=http://127.0.0.1:3180 \
    ENABLE_CHATGPT_PLAN=true
RUN apt-get update && apt-get install -y --no-install-recommends nginx openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && install -d -m 0700 -o postgres -g postgres /var/lib/postgresql/data
COPY --from=backend /usr/local/bin/node /usr/local/bin/node
COPY --from=backend --chown=postgres:postgres /app /app
COPY --from=frontend-build /app/dist-web /usr/share/nginx/html
COPY ops/nginx.conf /etc/nginx/nginx.conf
RUN sed -i 's@http://backend:3181@http://127.0.0.1:3181@' /etc/nginx/nginx.conf
COPY --chown=postgres:postgres ops/standalone.mjs /app/standalone.mjs
USER postgres
EXPOSE 8080
VOLUME ["/var/lib/postgresql/data"]
HEALTHCHECK --interval=10s --timeout=4s --start-period=25s --retries=8 CMD ["node","-e","fetch('http://127.0.0.1:8080/api/health').then(r=>{process.exitCode=r.ok?0:1}).catch(()=>{process.exitCode=1})"]
ENTRYPOINT ["node", "/app/standalone.mjs"]
CMD []
