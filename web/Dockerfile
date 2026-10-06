# Frontend image: build the React app, serve it with nginx, proxy /api to the API service.
# Build context is the repository root (the app imports ../fixtures for its offline fallback):
#   docker build -f web/Dockerfile .
FROM node:24-alpine AS build
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
COPY fixtures/ /src/fixtures/
RUN npm run build

FROM nginx:1.29-alpine
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
