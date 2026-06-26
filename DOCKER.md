# Docker

> Immagini basate su **node:24-bookworm-slim** (Node ≥ 24, vedi `.nvmrc`). Scelto glibc su musl
> perché `bcrypt` gira sul threadpool di libuv, dove l'allocatore di musl crea contesa sotto carico;
> bookworm offre prebuilt nativi e runtime più prevedibile. Dalla v3 il **data layer**
> (`@volcanicminds/backend/typeorm`) è incluso: l'immagine reintegra i peer del data layer
> (`typeorm`, `pg`, `bcrypt`, `reflect-metadata`, `pluralize`), che nel framework sono dichiarati
> come devDeps. Per usarlo serve un Postgres raggiungibile.

## PostgreSQL

```zsh
docker pull postgres:18

# senza volume dati
docker run -itd -e POSTGRES_USER=vminds -e POSTGRES_PASSWORD=vminds -p 5432:5432 --name vminds-database postgres:18

# con volume dati
docker run -itd \
  --name vminds-database \
  -e POSTGRES_USER=vminds \
  -e POSTGRES_PASSWORD=vminds \
  -p 5432:5432 \
  -v ${PWD}/data:/var/lib/postgresql \
  postgres:18
```

Variabili lette dal data layer (vedi `docs/CONFIGURATION.md`): `DB_HOST`, `DB_PORT`, `DB_USERNAME`,
`DB_PASSWORD`, `DB_NAME` (default `vminds`).

## pgAdmin (GUI PostgreSQL)

```zsh
docker pull dpage/pgadmin4:latest

docker run --name vminds-pgadmin -p 5051:80 \
  -e "PGADMIN_DEFAULT_EMAIL=developers@volcanicminds.com" \
  -e "PGADMIN_DEFAULT_PASSWORD=vminds" \
  -d dpage/pgadmin4

# IP del container Postgres per connettere pgAdmin
docker inspect $(docker ps -aqf "name=vminds-database") | grep -E '^\s+"IPAddress":' | awk -F'"' '{print $4}' | head -1
```

pgAdmin su `http://127.0.0.1:5051` (login con le credenziali sopra; aggiungi un server usando l'IP del container Postgres).

## Build & Run del backend

```zsh
# dev (hot-reload tsx watch; monta il sorgente come volume)
docker build -f Dockerfile -t volcanic-backend:dev .
docker run --rm -p 2230:2230 \
  -v ${PWD}:/usr/src/app -v /usr/src/app/node_modules \
  --env-file .env -it volcanic-backend:dev

# prod (multi-stage: build tsc + runtime snello)
docker build -f Dockerfile.prod -t volcanic-backend-prod .
docker run -dp 2230:2230 --env-file .env -it volcanic-backend-prod

# detached con autoremove allo stop
docker run --rm -dp 2230:2230 --env-file .env -it volcanic-backend-prod

# remove
docker image rm volcanic-backend-prod

# prune di tutto
docker system prune --all
```

> **Rete:** per far parlare il backend con Postgres usa una rete docker condivisa
> (`docker network create vminds && docker run --network vminds ...` per entrambi i container)
> e imposta `DB_HOST=vminds-database`. In alternativa, su Linux `--network=host`, oppure
> `host.docker.internal` su Docker Desktop (Mac/Windows).
