# Stage 1: Dipendenze (con toolchain di fallback per i moduli nativi del data layer)
FROM node:24-bookworm-slim AS deps

WORKDIR /usr/src/app

# Su bookworm/glibc bcrypt ha i prebuilt: questi servono solo come fallback di build.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

# Installa TUTTE le dipendenze: devDeps incluse (typeorm/pg/bcrypt + tsx per l'hot-reload)
RUN npm install

# Stage 2: Dev runner (hot-reload via `tsx watch`; il sorgente arriva dal volume -v)
FROM node:24-bookworm-slim AS dev-runner

LABEL description="Volcanic Backend (dev)"
LABEL maintainer="Developers <developers@volcanicminds.com>"

WORKDIR /usr/src/app

# Riusa i node_modules (con bcrypt già risolto) senza portarsi dietro i compilatori
COPY --from=deps /usr/src/app/node_modules ./node_modules
COPY . .

EXPOSE 2230

# `dev` = tsx watch --env-file .env server.ts → monta il sorgente e passa .env a runtime
CMD ["npm", "run", "dev"]
