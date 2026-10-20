# Фронтенд «Финансы» в контейнере: сборка на Node, раздача статикой через nginx.
#
# Зачем, если прод на Vercel: тот же артефакт можно поднять где угодно — на своём сервере,
# у проверяющего, в CI. Образ не зависит от Vercel и не содержит секретов.
#
#   docker build -t finance-web \
#     --build-arg VITE_SUPABASE_URL=http://127.0.0.1:54321 \
#     --build-arg VITE_SUPABASE_ANON_KEY=<anon key> .
#   docker run --rm -p 8080:8080 -e SUPABASE_URL=http://127.0.0.1:54321 finance-web
#
# Переменные VITE_* вшиваются в сборку (так устроен Vite), поэтому это build-arg.
# Все они публичные: anon-ключ и Client ID видны в коде любой страницы приложения.

# --- 1. Сборка ---------------------------------------------------------------
FROM node:22.20.0-alpine3.22 AS build
WORKDIR /app

# Сначала только манифесты: слой с зависимостями пересобирается, лишь когда они меняются.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_DEMO_PASSWORD=demo-password-2026
ARG VITE_GA_ID=
ARG VITE_GOOGLE_CLIENT_ID=
RUN test -n "$VITE_SUPABASE_URL" && test -n "$VITE_SUPABASE_ANON_KEY" \
    || (echo "Нужны --build-arg VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY" && exit 1)
RUN npm run build

# --- 2. Раздача --------------------------------------------------------------
# Непривилегированный nginx: процесс не root и слушает 8080.
FROM nginxinc/nginx-unprivileged:1.27.5-alpine3.21
COPY docker/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY docker/security-headers.inc.template /etc/nginx/templates/security-headers.inc.template
COPY --from=build /app/dist /usr/share/nginx/html

# Адрес Supabase для CSP (connect-src). Подставляется при запуске контейнера.
ENV SUPABASE_URL=http://127.0.0.1:54321
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
