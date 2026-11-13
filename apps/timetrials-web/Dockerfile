FROM node:26.13.0-bookworm-slim@sha256:bc0a2afd3b74ce12222fc8bab99271e66257f021078f5f4a5d687a77d280c1d9 AS build
WORKDIR /build/apps/timetrials-web
COPY apps/timetrials-web/package.json apps/timetrials-web/package-lock.json ./
RUN npm ci --ignore-scripts
COPY apps/timetrials-web/tsconfig*.json ./
COPY apps/timetrials-web/src ./src
RUN npm run build
COPY packages/assets/collection /build/packages/assets/collection
COPY packages/assets/web-asset-selection-v1.json /build/packages/assets/web-asset-selection-v1.json
COPY tooling/assets/materialize_collection.mjs /build/tooling/assets/materialize_collection.mjs
RUN node /build/tooling/assets/materialize_collection.mjs web /build/web-assets

FROM node:26.13.0-bookworm-slim@sha256:bc0a2afd3b74ce12222fc8bab99271e66257f021078f5f4a5d687a77d280c1d9 AS scanner
WORKDIR /build/apps/timetrials-scanner-web
COPY apps/timetrials-scanner-web/package.json apps/timetrials-scanner-web/package-lock.json ./
RUN npm ci --ignore-scripts
COPY apps/timetrials-scanner-web/ ./
# The scanner imports the central reader's TypeScript (packages/icon-matcher/ts) from 46 places.
COPY packages/icon-matcher /build/packages/icon-matcher
COPY packages/assets/collection /build/packages/assets/collection
COPY tooling/assets/materialize_collection.mjs /build/tooling/assets/materialize_collection.mjs
RUN mkdir -p public && node /build/tooling/assets/materialize_collection.mjs scanner-runtime /build/apps/timetrials-scanner-web/public
RUN npm run sync-assets
RUN MK8_BASE_PATH=/scanner/ npm run build

FROM caddy:2.11.8-alpine@sha256:f6228111e5fafa1a5238258d0858e103f10599b8d1659a146e7726681a002bb9
COPY apps/timetrials-web/index.html apps/timetrials-web/manifest.webmanifest apps/timetrials-web/sw.js apps/timetrials-web/assetlinks.json /srv/
COPY apps/timetrials-web/assetlinks.json /srv/.well-known/assetlinks.json
COPY apps/timetrials-web/styles /srv/styles
COPY infrastructure/docker/offline-invite /opt/mk8dx/offline-invite
COPY --from=build /build/apps/timetrials-web/dist /srv/dist
COPY --from=build /build/web-assets /srv/assets
COPY --from=scanner /build/apps/timetrials-scanner-web/dist /srv/scanner
COPY infrastructure/docker/Caddyfile.local /etc/caddy/Caddyfile
EXPOSE 80
