# Magic Query (v5)

> **Status: specification. Implement exactly this.**
> Target: `@volcanicminds/backend` v5. Tasks **T-0.3** (this document) and **T-2.4** (its
> implementation) of `EVO_FRAMEWORK.md`.
> This is also the **client migration guide**: section 9 maps every v4 form to its v5 form.
> The v4 behaviour is described in `docs/DATA_LAYER_MAGIC.md`, which v5 replaces.

The Magic Query turns an HTTP query string into a database query. It is public API: every
client, every admin UI, every integration depends on it. v5 breaks it **once**, on purpose, to
remove seven incoherences that could not be fixed compatibly. They are listed in section 8.

---

## 1. Shape of a request

```
GET /orders?status:eq=active&amount:gt=1000&_sort=-amount&_page=2&_pageSize=50
```

Two kinds of parameter, and nothing else:

| Kind | Form | Meaning |
|---|---|---|
| **Reserved** | starts with `_` | how to page, sort, project, join, combine |
| **Filter** | `field[:operator][alias]=value` | a condition on a column |

**Every reserved parameter starts with `_`.** In v4 some did (`_logic`) and some did not
(`page`, `sort`, `take`), so a column actually named `page` or `sort` was unreachable. In v5 the
prefix is the rule, with no exception: any parameter that does not start with `_` is a filter on
a column.

---

## 2. Reserved parameters

| Parameter | Default | Meaning |
|---|---|---|
| `_page` | `1` | page number, **1-based**. `_page=0` or negative responds 400 |
| `_pageSize` | `25` | rows per page. Clamped to `maxPageSize` (default 100, configurable per app or via `VOLCANIC_MAX_PAGE_SIZE`). The applied value is reported in the `v-pageSize` response header |
| `_sort` | none | comma-separated fields; a leading `-` means descending: `_sort=-createdAt,name`. An unknown field responds **400** |
| `_fields` | all | comma-separated projection: `_fields=id,name`. An unknown or sensitive field responds **400** |
| `_relations` | none | comma-separated relations to join, dot-notation for depth: `_relations=client,client.address`. A relation the route does not allow responds **400** |
| `_logic` | none | boolean expression over aliased conditions, see section 5 |
| `_withDeleted` | `false` | include soft-deleted rows. Allowed **only** if the route declares `allowWithDeleted: true`, otherwise 400 |

Removed from v4: `page`, `pageSize`, `sort`, `skip`, `take`. `skip`/`take` do not come back
under a new name: page and page size describe the same thing and having both invites two
answers to one question.

---

## 3. Filter grammar

```
field[:operator][alias]=value
```

- **field**: a column of the queried entity, or `relation.column` for a joined relation. The
  relation must be listed in `_relations` or allowed by the route, otherwise **400**.
- **operator**: one of section 4, **lowercase, exact match**. In v4 operator names matched
  case-insensitively (`:isEmpty`, `:ISEMPTY`); in v5 an unknown or wrongly-cased operator
  responds **400** instead of being treated as part of the column name.
- **alias**: `[alias]`, charset `[A-Za-z_][A-Za-z0-9_]{0,31}`, used only by `_logic`.
- **value**: always a string in the query string. Coercion rules in section 6.

Omitting the operator means `:eq`: `?status=active` is `?status:eq=active`.

**Repeating a field with the same operator and no alias** responds 400. It is ambiguous, and v4
silently kept the last one.

---

## 4. Operator catalogue

**Naming rule, uniform and without exceptions:**

- the **base** form is **case-sensitive**;
- the suffix **`i`** makes it case-insensitive: `:contains` / `:containsi`;
- the prefix **`n`** negates it: `:ncontains`, `:ncontainsi`.

In v4 the base form was case-**insensitive** or case-sensitive depending on the environment
variable `VOLCANIC_CASE_INSENSITIVE_DEFAULT`, so the same URL returned different results on two
servers of the same product. **That switch is removed.** Case sensitivity is a property of the
operator, visible in the URL.

### 4.1 Null and empty

| Operator | Value | Meaning |
|---|---|---|
| `:null` | `true` / `false` | `IS NULL` / `IS NOT NULL` |
| `:empty` | `true` / `false` | `= ''` / `<> ''`, text columns only |

Any other value responds 400. Removed: `:notNull`, `:isEmpty`, `:isNotEmpty` (three operators
that duplicated two meanings, two of which ignored their value entirely).

### 4.2 Equality and set membership

| Operator | Example | Meaning |
|---|---|---|
| `:eq` / `:neq` | `status:eq=active` | exact, case-sensitive |
| `:eqi` / `:neqi` | `email:eqi=Foo@Bar.com` | exact, case-insensitive |
| `:in` / `:nin` | `id:in=a,b,c` | set membership, comma-separated, exact |

`:in` splits on `,` and does not support values containing a comma: that is a documented limit,
not a bug to work around with an escape character. An empty element (`a,,b`) responds 400.

### 4.3 Text matching

| Operator | Matches |
|---|---|
| `:contains` / `:containsi` / `:ncontains` / `:ncontainsi` | value anywhere |
| `:starts` / `:startsi` / `:nstarts` / `:nstartsi` | value at the beginning |
| `:ends` / `:endsi` / `:nends` / `:nendsi` | value at the end |
| `:like` / `:likei` / `:nlike` / `:nlikei` | raw pattern: `%` and `_` are wildcards |

**Escaping, and it is mandatory.** For `contains`, `starts` and `ends` the value is user data:
`%`, `_` and the escape character itself are escaped before building the pattern, and the query
is emitted with `ESCAPE '\'`. In v4 they were not, so `amount:contains=50%` searched for
anything starting with `50`. For `:like` the wildcards are the caller's intent and are **not**
escaped: that is the whole point of the operator.

### 4.4 Comparison

| Operator | Example | Meaning |
|---|---|---|
| `:gt` `:ge` `:lt` `:le` | `price:ge=100`, `createdAt:lt=2026-01-01` | numbers, dates, timestamps |
| `:between` / `:nbetween` | `createdAt:between=2026-01-01..2026-12-31` | inclusive range |

**The range separator is `..`, not `:`.** In v4 it was `:`, which collides with the operator
separator and with any ISO timestamp: `createdAt:between=2026-01-01T00:00:00Z:2026-12-31T23:59:59Z`
split into five parts and the condition was **silently dropped**. A malformed range now responds
400.

### 4.5 Arrays and JSON, Postgres only

| Operator | SQL | Engines |
|---|---|---|
| `:arrayContains` | `@>` | Postgres |
| `:arrayContainedBy` | `<@` | Postgres |
| `:arrayOverlaps` | `&&` | Postgres (renamed from `:overlap`) |
| `:jsonHasKey` | `?` | Postgres |
| `:jsonHasAllKeys` | `?&` | Postgres |
| `:jsonHasAnyKey` | `?\|` | Postgres |

On SQLite and libSQL these respond **400** with `QUERY_OPERATOR_NOT_SUPPORTED_BY_ENGINE`, naming
the operator and the engine. They are never silently ignored and never emulated with a slower
approximation: an application that needs them declares Postgres.

### 4.6 Removed

| Removed | Why | Use instead |
|---|---|---|
| `:raw` | interpolates a caller-supplied SQL fragment into the query. With a tenant container in reach it is a way across the boundary (defect D-12). The environment flag that gated it is removed too | write the query in your own service |
| `:eqs` `:neqs` `:containss` `:ncontainss` `:startss` `:nstartss` `:endss` `:nendss` `:likes` `:nlikes` | the `s` suffix meant "strict", which is now the meaning of the base form | drop the `s` |
| `:notNull` `:isEmpty` `:isNotEmpty` | see §4.1 | `:null=false`, `:empty=true|false` |

---

## 5. Boolean logic: `_logic`

Conditions are combined with `AND` by default. `_logic` expresses anything else.

```
?status:eq[s1]=pending&createdAt:ge[d1]=2026-01-01&status:eq[s2]=urgent&_logic=(s1 AND d1) OR s2
```

**Grammar**: aliases, the keywords `AND`, `OR`, `NOT` (case-insensitive), parentheses. Nothing
else. **Limits, all enforced, all responding 400 when exceeded:**

| Limit | Default | Configurable |
|---|---|---|
| expression length | 512 characters | yes |
| nesting depth | 8 | yes |
| number of aliases | 32 | yes |

**Errors that v4 hid and v5 reports:**

| Situation | v4 | v5 |
|---|---|---|
| unparseable expression | falls back to `AND` of everything, returning a different result set with no warning | **400** `QUERY_LOGIC_INVALID` |
| depth or length exceeded | recursion error caught, same silent fallback | **400** `QUERY_LOGIC_TOO_COMPLEX` |
| alias used in `_logic` but never defined | condition ignored | **400** `QUERY_LOGIC_UNKNOWN_ALIAS` |
| condition defined but never used in `_logic` | condition silently dropped | **400** `QUERY_LOGIC_UNUSED_ALIAS` |
| `_logic` present and some conditions have no alias | ambiguous | **400** `QUERY_LOGIC_MISSING_ALIAS` |

The silent fallback of v4 (`query.ts:199-202`) is the defect D-13 and does not survive in any
form: an invalid expression is a caller error, and answering with a different query than the one
asked is worse than answering with an error.

---

## 6. Value coercion

| Written | Becomes |
|---|---|
| `true` / `false` (any case) | boolean |
| `null` (any case) | SQL `NULL` |
| a number, for a numeric or date column | number / date |
| anything else | string |

Coercion is driven by the **column type**, not by the shape of the string: `code:eq=0042` on a
text column stays the string `0042`. In v4 a numeric-looking string was coerced regardless, so
leading zeros were lost.

An empty value (`name:contains=`) responds **400**. In v4 it became the literal sentinel
`notFound` and searched for that string.

---

## 7. Response

Results are returned as the body; pagination travels in headers:

| Header | Meaning |
|---|---|
| `v-count` | rows in this response |
| `v-total` | rows matching the filter, ignoring pagination |
| `v-page` | page returned |
| `v-pageSize` | page size **actually applied**, after clamping |
| `v-pageCount` | number of pages |

Errors use the framework's standard error body with a stable machine-readable `code`:

```
QUERY_UNKNOWN_FIELD · QUERY_UNKNOWN_OPERATOR · QUERY_INVALID_VALUE · QUERY_EMPTY_VALUE
QUERY_SENSITIVE_FIELD · QUERY_RELATION_NOT_ALLOWED · QUERY_INVALID_RANGE
QUERY_OPERATOR_NOT_SUPPORTED_BY_ENGINE · QUERY_LOGIC_INVALID · QUERY_LOGIC_TOO_COMPLEX
QUERY_LOGIC_UNKNOWN_ALIAS · QUERY_LOGIC_UNUSED_ALIAS · QUERY_LOGIC_MISSING_ALIAS
QUERY_DUPLICATE_CONDITION · QUERY_WITH_DELETED_NOT_ALLOWED
```

The message names the offending parameter. It never echoes the value back verbatim into an
error string that could be reflected.

---

## 8. Engine portability

| Capability | Postgres | SQLite / libSQL |
|---|---|---|
| equality, set membership, comparison, ranges | yes | yes |
| `contains` / `starts` / `ends` / `like`, case-sensitive | yes | yes, via `PRAGMA case_sensitive_like = ON` set per connection |
| the `i` variants | `ILIKE`, locale-aware | `lower(col) LIKE lower(?)`, **ASCII only** unless the ICU extension is loaded |
| array operators | yes | **400** |
| JSON key-existence operators | yes | **400** |
| `_logic`, `_sort`, `_fields`, `_relations`, pagination | yes | yes |

The ASCII-only case folding on SQLite is a real limit and must appear in the README next to the
SQLite adapter, not only here.

---

## 9. v4 → v5 correspondence

| v4 | v5 | Note |
|---|---|---|
| `page=2` | `_page=2` | |
| `pageSize=50` | `_pageSize=50` | |
| `skip=100&take=50` | `_page=3&_pageSize=50` | removed |
| `sort=amount:desc` | `_sort=-amount` | the colon separator is gone |
| `sort=a:asc,b:desc` | `_sort=a,-b` | |
| `_logic=...` | `_logic=...` | unchanged, but errors are now 400 |
| `status:eq=active` | unchanged | **but** `:eq` is now case-sensitive by default |
| `name:eq=john` matching `John` | `name:eqi=john` | the old default depended on an env var |
| `:eqs` `:containss` `:startss` `:endss` `:likes` | `:eq` `:contains` `:starts` `:ends` `:like` | drop the `s` |
| `:notNull=true` | `:null=false` | |
| `:isEmpty` / `:isNotEmpty` | `:empty=true` / `:empty=false` | |
| `date:between=2026-01-01:2026-12-31` | `date:between=2026-01-01..2026-12-31` | |
| `:overlap` | `:arrayOverlaps` | |
| `:raw` | removed | no replacement by design |
| filter on `password` or another sensitive field | 400 | it was allowed and it was an oracle |
| invalid `_logic` returning results | 400 | |
| unknown sort field silently skipped | 400 | |
| `amount:contains=50%` treated `%` as a wildcard | `%` is escaped | use `:like` for patterns |

Every row of this table must appear in `docs/MIGRATION_V4_V5.md` (task T-8.3) and must be
checked against `volcanic-admin` during T-8.4.

---

## 10. `req.data()` and where parameters come from

`req.data()` returns the **merge of query string and body**, with the **body winning** on a
duplicate key. In v4 it returned one **or** the other (`lib/util/common.ts:9`): if the query
string had a single non-null value, the body was discarded entirely, so
`POST /auth/login?x=1` with credentials in the body failed with "Email not valid" (defect D-29).

Two explicit accessors exist for code that must not guess: `req.queryData()` and
`req.bodyData()`. `req.data()` stays the default for controllers.

---

## 11. Implementation notes for T-2.4

1. One catalogue module declares, for each operator: name, arity, accepted column types,
   supported engines, and the builder per dialect. The HTTP layer never sees a dialect.
2. The parser rejects before it builds. Validation order: reserved parameters, then field
   existence, then operator, then value coercion, then `_logic`. The first error wins and it is
   the one reported.
3. No condition is ever dropped silently. If the code has a branch that skips a condition, that
   branch is a bug: it must throw.
4. Views (`executeFindView` in v4) keep the same guard as entity queries: without an explicit
   handle in multi-tenant mode the call **throws** (defect D-06). There is no global fallback to
   fall back to any more.
5. The test suite runs the same battery against Postgres and SQLite, asserting identical results
   where the capability exists and a 400 with the right `code` where it does not.
