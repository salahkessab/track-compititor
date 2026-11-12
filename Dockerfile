FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
# better-sqlite3 ships Node-API binaries; npm's implicit node-gyp hook is not
# needed. Canvas is optional for server rendering; install its shipped binary.
RUN npm ci --ignore-scripts && npm rebuild canvas
COPY . .
RUN npm run build:recipe-intelligence && npm run build

FROM node:24-bookworm-slim AS runtime
ARG APP_REVISION=""
LABEL org.opencontainers.image.revision=$APP_REVISION
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 APP_REVISION=$APP_REVISION
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /var/lib/recipe-intelligence && chown node:node /var/lib/recipe-intelligence
USER node
EXPOSE 3000
CMD ["node", "scripts/recipe-intelligence-server.cjs"]
