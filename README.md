# Yopem Auth

Authentication API with Google OAuth, [OpenAuth](https://openauth.js.org),
Cloudflare Workers, and D1. [Alchemy v2](https://alchemy.run) manages Worker
bindings, database migrations, and deployment. No Wrangler configuration or
`.dev.vars` file is needed.

Worker handlers, database queries, and validation use Effect. The database layer
uses the
[Effect v4 D1Client](https://effect.website/docs/v4/api/sql-d1/D1Client). Effect
Schema validates configuration, Google profiles, subjects, and database records.
Drizzle uses the same D1Client for typed Effect queries. It also defines tables
and generates migrations. D1Client batches keep user and account writes atomic.
OpenAuth uses a small Promise adapter at the library boundary.

## Setup

Requirements: Vite+ (`vp`), Bun, a Cloudflare account, and Google OAuth
credentials. The configured DNS zone and D1 database must be in the Cloudflare
account that you use. All deployment settings and credentials come from `.env`.

```sh
vp install
cp .env.example .env
```

Fill `.env` with Google OAuth credentials, Cloudflare credentials, and the
settings from `.env.example`. Alchemy loads and validates this file before it
changes resources. Binding definitions stay in `alchemy.run.ts`.

If you do not use an API token, configure or renew Alchemy login:

```sh
vp run cf:login
```

Alchemy uses its encrypted Cloudflare state store. No `ALCHEMY_PASSWORD` or
local state key is needed. The first plan, development, or deployment command
can ask to create a state-store Worker, Durable Object, and secret entries.
Approve this only when you can change the Cloudflare account. This setup does
not create those resources.

Keep `.env`, `.alchemy/`, and Alchemy profile credentials private. Alchemy v1
state is not converted to v2 state. Keep old state and its key for backups.

Set Google OAuth redirect URIs with the `/google/callback` path. Use the
configured production domain and local origin from `.env`.

## Development

```sh
vp run dev
```

Alchemy starts Worker on the configured local port and applies SQLite migrations
to local D1. Local D1 is separate from production. Development does not copy
production records or attach the production domain.

Users, accounts, OpenAuth signing keys, and tokens use D1. Short token expiry
times do not need the former KV TTL workaround. Expired auth records are
excluded from reads and scans. Storage writes remove expired records.

## Schema changes

Edit `src/lib/db/schema.ts`, then generate a migration:

```sh
vp run db:generate
vp run db:check
```

Alchemy applies pending SQL migrations during development and deployment. Do not
run Drizzle migrations separately.

This change starts with empty D1 tables. It does not copy PostgreSQL users or KV
records. Users must sign in again. Old databases and KV namespaces are not
deleted. The target D1 database must not contain conflicting tables. Review its
schema before the first deployment.

## Build

```sh
pnpm run build
```

This command uses the installed Vite+ binary. It writes the native Alchemy
Worker bundle to `dist/worker.js`. Set `APP_NAME` in `.env` or the process
environment. The bundle uses the `prod` stage. Google and Cloudflare credentials
stay out of the bundle. This command does not deploy resources or apply
migrations.

Alchemy deployment still builds `src/index.ts` and registers the D1 binding.

## Validation

```sh
vp check
vp run lint
vp run typecheck
vp run format:check
vp test --reporter=default --reporter=json --outputFile=/tmp/yopem-auth-tests.json
```

Tests run the build script through the installed Vite+ binary, without global
`vp` or `pnpm` binaries. They load `dist/worker.js` with local D1. They check
JSON storage, exact expiry, prefix scans, pagination, user/account writes,
rollback, OAuth discovery, persistent signing keys, and Google OAuth callbacks.
Tests use local Google responses to check user creation and rejected unverified
email. They also check concurrent requests. No Cloudflare credentials or `.env`
file is needed for tests. Real Google sign-in needs OAuth credentials and a
browser.

## Deployment

```sh
vp run deploy
```

Alchemy checks the configured D1 ID and name, adopts the database, applies
pending migrations, and deploys the configured Worker and domain. D1 deletion is
blocked by the Alchemy retention policy. Alchemy keeps the current D1
jurisdiction and replication mode.

Deployment changes live Worker code, secrets, domain bindings, and D1 tables.
Check the Cloudflare account, D1 schema, and domain owner before deployment. If
another Worker owns the configured domain, resolve the conflict before
deployment.

## License

AGPL-3.0-or-later. See [LICENSE.md](./LICENSE.md).
