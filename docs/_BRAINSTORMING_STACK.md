# Stack brainstorming

Status: brainstorming. The decisions taken on 2026-10-01 are listed below; everything else is still open. Postgres is the only database engine, for the control plane and for tenants; PGlite stays for development and tests.

Licenses checked on 2026-10-01 against the npm registry, the GitHub API and the license files; embedding model licenses still to verify. Status in the scenario tables: exists, partial, to build, external (a service outside the application), open (decision pending).

Out of scope for now in every scenario: replication, backups, retention, durable agents, local inference, edge and TLS, egress, release.

## Decisions on 2026-10-01

- Scenarios: S1, S2 and S3 only. Encryption in use, the former S4 and S5, is out of the horizon.
- Database: Postgres only, for the control plane and for tenants. SQLite and libSQL leave the framework; PGlite stays for development and tests.
- Runtime: Node 26 in the six v5 repos, `.nvmrc` at v26.10.0 and `engines` at `>=26`; tsx 4.23 avoids the `module.register` deprecation (DEP0205).
- Vectors: pgvector and LanceDB, both as rag engines behind `RetrievalStore`.
- Logging: pino stays, JSON in production and pretty output only in development, handed to Fastify as `loggerInstance`, with `redact` on secrets.
- Tracing and metrics: OpenTelemetry over OTLP with `@fastify/otel`.
- Models and agents: AI SDK 7 and its `ToolLoopAgent` in tools, in place of the Mastra wrapper; peer ranges closed.
- MCP: a `defineTool` contract with adapters in tools, the MCP server included; the backend knows nothing about MCP (refined on 2026-10-03). The consumer mounts the server as one of its own routes and picks its tools one by one; every tool acts with the caller's identity and calls the API, never the database (rag T-7.6).

## S1: single tenant, no RAG, no files

Workforce management, Gantt, ERP.

| Layer | Technology | Status | Note |
|---|---|---|---|
| Runtime | Node.js 26, TypeScript | exists | `.nvmrc` v26.10.0, `engines >=26`; 26 becomes LTS on 2026-10-28 |
| API | Fastify 5 through `@volcanicminds/backend` | exists | JSON Schema for validation and OpenAPI |
| Profile | single tenant, no `tenants` block | exists | `capabilities.ts` refuses a forbidden combination at boot |
| Database | PostgreSQL 18, one database | partial | CI still runs on Postgres 16; PGlite for development and tests |
| Data access | Drizzle, drizzle-kit, framework migration runner | exists | forward-only migrations |
| Schema | tables in code, manifest for the admin | exists | collections defined by users: open |
| Login | flow engine: password, email OTP, TOTP, OIDC towards the customer's IdP | exists | |
| Authorization | capabilities, closed catalog | exists | |
| Admin | `@volcanicminds/admin`, manifest-driven | exists | |
| Scheduled jobs | `@fastify/schedule` and toad-scheduler, in process | exists | no cross-process guard found: one process |
| Cache | in process (`global.cache`) | exists | invalidation stays inside one instance |
| Audit | `change` and `access_log`, append-only | exists | no hash chain |
| Mail | nodemailer through `@volcanicminds/tools` | exists | |
| Observability | pino as logger, OpenTelemetry over OTLP | exists | JSON in production, `pino-pretty` only in development, one instance handed to Fastify as `loggerInstance`, `redact` on secrets; `@fastify/otel` and the OpenTelemetry SDK are optional peers |
| Encryption at rest | disk or managed Postgres encryption | external | |

## S2: single tenant with RAG and files

Document management with a connected AI agent. Everything in S1, plus:

| Layer | Technology | Status | Note |
|---|---|---|---|
| Vectors | pgvector in the same database, or LanceDB in process: two rag engines behind `RetrievalStore` | exists | rag engines `lancedb` and `postgres` (rag T-11.3); the second offers pgvector HNSW and pgvectorscale DiskANN. pgvector: one transaction and one backup with the rows. LanceDB: large corpora |
| Full-text | Postgres full-text search with pgvector, the LanceDB full-text index with LanceDB; fused with vectors by RRF | exists | both engines fuse the two rankings; on Postgres the lexical leg is BM25 where `pg_textsearch` is loaded, a GIN index on `to_tsvector` otherwise (PGlite included) |
| Files | tus uploads to a directory or S3-compatible storage | exists | `@tus/file-store`, `@tus/s3-store` in tools |
| Ingestion | pdfjs-dist, rag ingest ledger | exists | in process |
| Embeddings, reranking | local ONNX model on onnxruntime-node | partial | the embedder exists in rag; the cross-encoder reranker is to build (rag T-4.2); an external API is allowed here |
| Models | AI SDK 7 through tools | partial | `ai` 6 installed; peer range open today (`ai >=4.0.0`) |
| Agent | AI SDK `ToolLoopAgent` over search and documents | to build | replaces the Mastra wrapper behind `createAgent`; durable agents out of scope for now |
| MCP | `defineTool` contract and adapters in tools, MCP server included; the consumer mounts it as its own route | to build | acts with the caller's identity and calls the API, never the database (rag T-7.6); `oidc-provider` only for third-party clients |
| Jobs | pg-boss on the same Postgres | to build | ingestion that survives restarts |

## S3: multi-tenant with RAG and files

Classic cloud SaaS. Everything in S2, plus or instead:

| Layer | Technology | Status | Note |
|---|---|---|---|
| Control plane | PostgreSQL 18: tenants, operators, identity providers | exists | `/system/*` routes |
| Tenant data | one Postgres database per tenant (`strategy: 'container'`), pgvector inside when that engine is chosen | partial | open: one schema per tenant (`strategy: 'schema'`), one connection pool instead of one per database |
| RAG corpora | one corpus per tenant, shared corpora offered through grants | exists | rag registry, `scope: 'tenant'` or `'shared'`; a corpus declares `engine: 'lancedb'` or `'postgres'` |
| Tenant resolution | from the token `tid`; header or subdomain only without a token | exists | a mismatch answers 403 `TENANT_MISMATCH` |
| Migrations | `npx volcanic migrate --tenants` | exists | one set for the control plane, one for tenants |
| Login | OIDC providers and MFA policy per tenant, set by the operator | exists | |
| Files | S3-compatible storage, one prefix per tenant | to build | a directory works only on one node |
| Jobs | pg-boss on the control plane Postgres | to build | with replicas a job must run once |
| Cache | in process, invalidation across replicas | to build | Postgres LISTEN/NOTIFY before Redis |
| Audit | `change` and `access_log` in each tenant database; governance events in the control plane | exists | `governance_log` in the control plane, read at `GET /system/governance-log` with the `governance-log` capability |
| Observability | tenant id on every span and log line | exists | `tenant_id` on log lines and `tenant.id` on spans, jobs on one tenant included; the id only, never the slug |
| Cross-tenant reports | none | open | out of scope for now; `postgres_fdw` or an export |

## Out of the horizon

S4 (single tenant with encryption in use) and S5 (multi-tenant with encryption and full isolation) left on 2026-10-01 together with SQLite. Both rested on one SQLCipher file per tenant, the piece that made a key the unit of deletion; without it the encrypted file, the process per tenant, the datasets copied into each tenant, key management and the hash-chained audit go too. Data at rest stays protected by disk or managed Postgres encryption, and Postgres TDE remains open in the table below.

## All components

| Layer | Chosen component | Scenarios | License or custom | Rationale | Alternatives |
|---|---|---|---|---|---|
| Runtime | Node.js 26, TypeScript, `node:crypto` | all | MIT, Apache-2.0 | `.nvmrc` v26.10.0 and `engines >=26` in the six v5 repos; LTS from 2026-10-28; the test suites pass on 26.9.0 (2026-10-01) | Bun, Deno, Go |
| Profiles | as now: `capabilities.ts` with boot refusal | all | custom (exists) | a forbidden combination does not start | scattered flags, one build per scenario |
| API | as now: Fastify 5, volcanic framework | all | MIT; custom (exists) | JSON Schema for validation and OpenAPI | Hono, NestJS, Express |
| Registry | as now: tables in code, admin manifest | all | custom (exists) | collections defined by users: open | Directus (license forbids competing use), Supabase, Strapi |
| Data access | as now: Drizzle, drizzle-kit, framework migration runner | all | Apache-2.0, MIT; custom (exists) | local benchmark against TypeORM 1.1.1 on 2026-10-01 (Node 26.9.0, Postgres 14, 10 concurrent clients): the query builder is 18 to 26% slower on five of six queries; prepared statements are 1.4 to 3.7 times faster than TypeORM, at 0.81 to 1.05 of raw `pg`; heap after load 9.4 MB against 14 MB; 100 tenant schemas on one pool hold one connection, one TypeORM data source per tenant (the v4 pattern) holds 100 | Kysely, Prisma, TypeORM |
| Control plane | PostgreSQL 18, `pg` driver | all | PostgreSQL, MIT | registry, identities, governance audit; CI still on 16 | CockroachDB, MySQL |
| Postgres TDE | open: none for now, disk or provider encryption | S1-S3 when self-hosted | PostgreSQL (pg_vault_tde) | at rest only: the server and every session with SELECT read plaintext; pg_tde runs only on Percona Server; pg_vault_tde started on 2026-07-17, its encrypted indexes preserve equality | pg_tde, pg_vault_tde |
| Tenant data | one Postgres 18 database per tenant; open: one schema per tenant | S3 | PostgreSQL | concurrent writers, mature HA; one schema per tenant shares one pool (see data access) | SQLite or libSQL file per tenant (dropped on 2026-10-01) |
| Vectors | pgvector in the database, or LanceDB in process; both rag engines behind `RetrievalStore` | S2 S3 | PostgreSQL; Apache-2.0 | pgvector: vectors live, die and are backed up with their rows, pgvectorscale only on a self-hosted Postgres; LanceDB: 10.2 ms exact scan of a filtered set on 250,000 chunks (rag measure); rag has both engines | Qdrant, Milvus, Vespa |
| Full-text search | Postgres full-text with pgvector, the LanceDB full-text index with LanceDB | S2 S3 | PostgreSQL; Apache-2.0 | rag fuses full-text and vector rankings with RRF on both engines; BM25 on Postgres needs `pg_textsearch` | Meilisearch, Typesense, OpenSearch |
| Cross-tenant analytics | DuckDB or `postgres_fdw` (candidates) | out of scope for now | MIT; PostgreSQL | | ClickHouse, the customer's warehouse |
| Files | directory, S3-compatible or none; tus | S2 S3 | MIT, Apache-2.0; external | per-tenant prefix to build; `minio` in tools duplicates `@aws-sdk/client-s3` | Garage, SeaweedFS, Ceph RGW |
| Control plane backup | managed PITR or pgBackRest (candidate) | out of scope for now | MIT | | WAL-G, Barman |
| Login | as now: flow engine with password, email OTP, TOTP, OIDC; passkeys (candidate) | all | custom (exists); SimpleWebAuthn MIT | the engine enforces the MFA floor; WebAuthn not in v5 | Keycloak, Zitadel, Authentik |
| Federation | as now: `openid-client` as the `oidc` stage, providers per tenant | all | MIT | SAML not implemented; Keycloak as a broker only on request | node-saml, WorkOS |
| Third-party apps, MCP clients | `oidc-provider` as OAuth 2.1 server | S2 S3, only for third-party delegated access | MIT; custom (to build) | own integrations use the existing machine credentials | Keycloak, Ory Hydra |
| Authorization | as now: capabilities; row rules later | all | custom (exists) | never a query parameter, never a model in the chain | Cedar, OpenFGA, OPA |
| Audit, history | two append-only levels: content in the tenant, governance in the control plane | all | custom (exists) | `change` and `access_log` exist per container, without hash chain; `governance_log` in the control plane survives tenant destruction | pgaudit, immudb, Debezium |
| Retention | Object Lock (candidate) | out of scope for now | provider feature | | legal hold |
| Workflows, queues, cron | `@fastify/schedule` in process; pg-boss when a job must survive restarts or run once across replicas | all; pg-boss in S2 S3 | MIT | no cross-process guard found today | DBOS, Temporal, BullMQ |
| Routing | as now: tenant from the token | S3 | custom (exists) | header or subdomain only without a token | load balancer hashing |
| Cache | as now: in process | all | custom (exists) | invalidation stays inside one instance (`CACHE.md`); with replicas Postgres LISTEN/NOTIFY first | Redis, Valkey |
| Models | AI SDK 7 in tools | S2 S3 | Apache-2.0 | `ai` 6 installed today; peer range `>=4.0.0` to close | LangChain.js, LiteLLM |
| Agents | AI SDK `ToolLoopAgent` in tools | S2 S3; durable agents out of scope for now | Apache-2.0 | replaces the Mastra wrapper behind `createAgent`, and with it the `@mastra/core >=1.0.0` peer | Mastra, LangGraph.js, OpenAI Agents SDK |
| MCP | `defineTool` contract and adapters in tools (AI SDK tools, `@ai-sdk/mcp`), MCP server included, mounted by the consumer as its own route; the backend knows nothing about MCP | S2 S3 | Apache-2.0; MCP SDK MIT, moving to Apache-2.0; custom (to build) | the server acts with the caller's identity and calls the API, never the database (rag T-7.6); third-party clients need the OAuth server | FastMCP, hand-written servers |
| Embeddings, reranking | local ONNX model on onnxruntime-node | S2 S3 | MIT; model license to verify | the embedder exists in rag, the reranker is to build (rag T-4.2); an external API is allowed | OpenAI API, Voyage, Mistral |
| Local inference | vLLM (candidate) | out of scope for now | Apache-2.0 | | llama.cpp, Ollama |
| Ingestion | pdfjs-dist, rag ingest ledger | S2 S3 | Apache-2.0; custom (exists) | in process | Docling, Unstructured, Tika |
| Admin | as now: `@volcanicminds/admin` on Refine and shadcn | all | custom (exists); MIT | reads the manifest | React Admin, Retool |
| Observability | pino: JSON in production, pretty only in development, handed to Fastify as `loggerInstance`, `redact` on secrets; OpenTelemetry over OTLP with `@fastify/otel`, trace ids in log lines | all | MIT; Apache-2.0 | no imposed backend: Grafana LGTM, SigNoz or a vendor read OTLP | Sentry SDK, vendor agents |
| Mail | as now: nodemailer in tools | all | MIT-0 | | SES, Postmark, Resend |
| Edge and TLS | Caddy (candidate) | not pertinent now | Apache-2.0 | | Traefik, nginx |
| Egress | ports checked by dependency-cruiser, host allowlist (candidate) | not pertinent now | MIT | | Smokescreen, Cilium |
| Release | signed OCI images, compose on VMs (candidate) | not pertinent now | Apache-2.0 | | Kubernetes, Kamal |
