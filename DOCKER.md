# Docker

> Images based on **node:24-bookworm-slim** (Node ≥ 24, see `.nvmrc`). glibc is preferred over musl
> because `bcrypt` runs on the libuv threadpool, where the musl allocator causes contention under load;
> bookworm ships native prebuilts and gives more predictable runtime performance. Since v3 the
> **data layer** (`@volcanicminds/backend/typeorm`) is included: the image reinstalls the data-layer
> peers (`typeorm`, `pg`, `bcrypt`, `reflect-metadata`, `pluralize`), which the framework declares as
> devDependencies. A reachable Postgres is required to use it.

## PostgreSQL

```zsh
docker pull postgres:18

# without data mount
docker run -itd -e POSTGRES_USER=vminds -e POSTGRES_PASSWORD=vminds -p 5432:5432 --name vminds-database postgres:18

# with data mount
docker run -itd \
  --name vminds-database \
  -e POSTGRES_USER=vminds \
  -e POSTGRES_PASSWORD=vminds \
  -p 5432:5432 \
  -v ${PWD}/data:/var/lib/postgresql \
  postgres:18
```

Variables read by the data layer (see `docs/CONFIGURATION.md`): `DB_HOST`, `DB_PORT`, `DB_USERNAME`,
`DB_PASSWORD`, `DB_NAME` (default `vminds`).

## pgAdmin (PostgreSQL GUI client)

```zsh
docker pull dpage/pgadmin4:latest

docker run --name vminds-pgadmin -p 5051:80 \
  -e "PGADMIN_DEFAULT_EMAIL=developers@volcanicminds.com" \
  -e "PGADMIN_DEFAULT_PASSWORD=vminds" \
  -d dpage/pgadmin4

# Postgres container IP to connect pgAdmin
docker inspect $(docker ps -aqf "name=vminds-database") | grep -E '^\s+"IPAddress":' | awk -F'"' '{print $4}' | head -1
```

pgAdmin at `http://127.0.0.1:5051` (log in with the credentials above; add a server using the Postgres container IP).

## Build & run the backend

```zsh
# dev (hot-reload via tsx watch; mounts the source as a volume)
docker build -f Dockerfile -t volcanic-backend:dev .
docker run --rm -p 2230:2230 \
  -v ${PWD}:/usr/src/app -v /usr/src/app/node_modules \
  --env-file .env -it volcanic-backend:dev

# prod (multi-stage: tsc build + slim runtime)
docker build -f Dockerfile.prod -t volcanic-backend-prod .
docker run -dp 2230:2230 --env-file .env -it volcanic-backend-prod

# detached with autoremove on stop
docker run --rm -dp 2230:2230 --env-file .env -it volcanic-backend-prod

# remove
docker image rm volcanic-backend-prod

# prune everything
docker system prune --all
```

> **Network:** to let the backend reach Postgres, use a shared docker network
> (`docker network create vminds` and `--network vminds` on both containers) and set
> `DB_HOST=vminds-database`. Alternatively `--network=host` on Linux, or `host.docker.internal`
> on Docker Desktop (Mac/Windows).
