FROM node:26.13.0-bookworm-slim@sha256:bc0a2afd3b74ce12222fc8bab99271e66257f021078f5f4a5d687a77d280c1d9 AS build
WORKDIR /build/backend/api
COPY backend/api/package.json backend/api/package-lock.json ./
RUN npm ci --ignore-scripts
COPY backend/api/tsconfig*.json ./
COPY backend/api/src ./src
RUN npm run build

FROM node:26.13.0-bookworm-slim@sha256:bc0a2afd3b74ce12222fc8bab99271e66257f021078f5f4a5d687a77d280c1d9
ENV NODE_ENV=production
WORKDIR /app/backend/api
COPY backend/api/package.json backend/api/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /build/backend/api/dist ./dist
COPY infrastructure/mysql /app/infrastructure/mysql
COPY infrastructure/mysql/reference /app/infrastructure/mysql/reference
COPY packages/assets/schema9-asset-catalog-v1.json /app/packages/assets/schema9-asset-catalog-v1.json
COPY tooling/docker/operator-command.sh /app/operator-command.sh
RUN useradd --system --uid 10001 --home /nonexistent mk8dx \
    && mkdir -p /run/mk8dx/host-state \
    && chown 10001:10001 /run/mk8dx/host-state \
    && chmod 0700 /run/mk8dx/host-state
USER 10001:10001
EXPOSE 8080
CMD ["node", "dist/composition/passwordless-hosted-main.js"]
