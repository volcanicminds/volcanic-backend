# Deployment profiles (v5)

One page to choose a deployment: which databases, what the framework encrypts, and who decides
how people log in. The details live in the documents each section points to; if this page and the
code disagree, the code wins.

## 1. Databases by profile

| Profile | Control plane database | Tenant databases | Notes |
|---|---|---|---|
| Single tenant | Postgres (production); SQLite or libSQL (CLI, agents, desktop); pglite for development only | none: the control plane database is the only one | `control.engine` defaults to `postgres` |
| Multi-tenant, one schema per tenant | Postgres | Postgres, same database | `strategy: 'schema'`; not available on SQLite or libSQL, which have no schemas |
| Multi-tenant, one database per tenant | Postgres | Postgres | `strategy: 'container'` |
| Multi-tenant, one file per tenant | Postgres, or SQLite/libSQL | SQLite or libSQL | `strategy: 'container'` |
| Refused at boot | pglite with a `tenants` block in production; MongoDB anywhere | | pglite hands out one shared connection, so it cannot isolate tenants |

The capability matrix is `lib/database/capabilities.ts`; the configuration blocks are in
[CONFIGURATION_V5.md](CONFIGURATION_V5.md) §2.

## 2. What the framework encrypts or hashes

The same in every profile.

| Data | How |
|---|---|
| Passwords | bcrypt, cost `BCRYPT_COST` (12 by default, 12 to 20) |
| MFA seed, client secret of a per-tenant OIDC provider | AES-256-GCM, key derived with scrypt from `MFA_DB_SECRET` (`JWT_SECRET` when absent) |
| Emailed codes (login, destruction) | HMAC-SHA256 keyed by the flow or token secret: the table alone cannot test a guess |
| Refresh and destruction tokens | SHA-256 of the token; the token itself is never stored |
| Client secret of a deployment OIDC provider | not stored: read from the variable named by `clientSecretEnv` |
| Databases and files at rest | not the framework's job: disk, database or provider encryption |

## 3. Authentication: who decides what

| Setting | Who decides | Default |
|---|---|---|
| Login methods (`password`, `email-otp`, `totp`, `oidc`) | the consuming project, in `config/authFlows.ts`, per plane and per role; the same for every tenant | `password`, then an optional `totp` stage, on both planes |
| OIDC providers of one tenant | the platform operator (`/tenants/:id/identity-providers`) | none |
| MFA policy of one tenant | the platform operator, in the tenant's `config.mfa_policy`; it may only tighten the deployment's | `OPTIONAL` |
| MFA policy of the platform operators | `system_mfa_policy`, never below the deployment's | the deployment's |
| Account creation (`invite`, `approval`, `open`) | the platform sets the allowed modes (for all tenants or one), the tenant admin chooses among them | `invite`: registration is closed |
| Session transport | `AUTH_MODE` | `COOKIE` (`BEARER` as the alternative) |
| SAML | not implemented | |

The login flow is specified in [AUTH_FLOW_V5.md](AUTH_FLOW_V5.md), the MFA policy levels in
[SECURITY_MFA.md](SECURITY_MFA.md), account creation in [API_V5.md](API_V5.md) §2.5.
