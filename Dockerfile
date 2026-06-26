# Stage 1: Dependencies (with fallback toolchain for the data-layer native modules)
FROM node:24-bookworm-slim AS deps

WORKDIR /usr/src/app

# On bookworm/glibc bcrypt has prebuilts: these are only a build fallback.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

# Install ALL dependencies, devDeps included (data layer typeorm/pg/bcrypt + tsx for hot-reload)
RUN npm install

# Stage 2: Dev runner (hot-reload via `tsx watch`; the source comes from the -v volume)
FROM node:24-bookworm-slim AS dev-runner

LABEL description="Volcanic Backend (dev)"
LABEL maintainer="Developers <developers@volcanicminds.com>"

WORKDIR /usr/src/app

# Reuse node_modules (with bcrypt already resolved) without dragging in the compilers
COPY --from=deps /usr/src/app/node_modules ./node_modules
COPY . .

EXPOSE 2230

# `dev` = tsx watch --env-file .env server.ts → mount the source and pass .env at runtime
CMD ["npm", "run", "dev"]
