# Database migration authority and schema isolation

The additive durable proposal lifecycle migration is
`20260910090000_add_durable_proposal_lifecycle`; it remains scoped entirely
to `genetia_app`.

Genetia uses Supabase Postgres as its database and Prisma as the authoritative
application-schema migration tool. The Prisma migrations under
`packages/db/prisma/migrations/` define application tables, indexes, foreign
keys, and constraints; the Prisma Client is generated from the same schema.

The schemas are intentionally isolated:

- `public` is preserved legacy state and is not used by the fresh Genetia
  runtime. Existing legacy tables and rows are not renamed, migrated, or
  modified.
- `genetia_app` is the only PostgreSQL schema for fresh Genetia application
  models, enums, projections, and indexed data.
- Prisma is the authority for the `genetia_app` application schema.
- The Cloudflare API accesses application data through repositories/Hyperdrive;
  the Supabase Data API is not the application boundary.

Connection roles are deliberately separate:

- `DIRECT_URL` is the Prisma migration/CLI connection. In the current Windows
  environment it uses Supavisor session mode on port 5432 and is scoped to
  `genetia_app` for Prisma migration commands.
- `DATABASE_URL` is for local Node development/testing only unless a specific
  non-Worker runtime explicitly consumes it. It is not a fallback for deployed
  Workers.
- Production Workers receive the `GENETIA_DB` Hyperdrive binding and use its
  `connectionString`. Hyperdrive's origin must be the Supabase Direct
  PostgreSQL connection, not either Supavisor pooler mode. The API uses the
  Hyperdrive-compatible `pg` driver (minimum pinned version 8.16.3).

The API Worker currently has no Hyperdrive resource ID configured, so its
dry-run exposes no database binding and it cannot be deployed as a connected
production API yet. Once an account-owned Hyperdrive configuration exists, add
only its ID to the `GENETIA_DB` binding in the Worker configuration; do not add
an environment-URL fallback.

The pending account operation is equivalent to:

`pnpm --filter @genetia/api-worker exec wrangler hyperdrive create genetia-db
--connection-string="<Supabase Direct PostgreSQL connection>"`

The connection string must be supplied securely and must use Supabase Direct
PostgreSQL. It is not committed or placed in Wrangler configuration. Hyperdrive
is included in Cloudflare Workers Free and Paid plans; the Free plan has a
documented daily query allowance, while Paid has unlimited query volume. The
resource is not created until the account-owned origin credential and binding
ID are ready.

The root `supabase/migrations/` directory contains only platform scheduling
configuration. `20260910000000_genetia_reconciliation_cron.sql` installs
`pg_cron`/`pg_net` and schedules the authenticated reconciliation wake-up. It
does not define application tables and must be applied only after the
application schema is available. Vault entries named
`genetia-reconcile-url` and `genetia-reconcile-secret` are required; values are
never stored in Git.

All raw SQL in the runtime must qualify fresh tables with
`genetia_app."TableName"`; it must not rely on an ambient `search_path` or an
unqualified name that could resolve to a legacy `public` table.

## Safe remote order

1. Inspect the linked project and existing public schema read-only.
2. Apply the Prisma application migrations with `prisma migrate deploy` using
   the confirmed Supabase Postgres connection. The migrations first create
   `genetia_app` and pin their session to it; they do not create fresh tables
   in `public`.
3. Verify tables, indexes, foreign keys, constraints, and migration history.
4. Store the two scheduler values in Supabase Vault through a secure channel.
5. Apply the root Supabase Cron migration and verify the one-minute schedule.

No `db reset --linked` operation is permitted. The Cron migration is additive
to the application schema and does not contain financial records.

## Remote inspection status

The linked `genetia` project was inspected read-only with Supabase CLI
2.116.0. Its remote migration history is empty, but its `public` schema is not
empty: legacy tables including `arc_trades`, `circle_wallets`, `wallet_balances`,
`wallet_transactions`, `bets`, `markets`, `positions`, and `settlements` exist.
The expected Prisma tables are deployed in `genetia_app`. The existing
`public` schema/data remains preserved legacy state. The Prisma migration
metadata is stored in `genetia_app._prisma_migrations`, and the three
source-controlled application migrations are up to date. The Cron migration
remains blocked until its real authenticated Cloudflare reconciliation target
exists; it must not schedule requests to a placeholder URL.

## Local validation

Prisma schema validation and an empty-database migration diff must be run with
the project-pinned Prisma 5.22.0 CLI before remote deployment. A local
PostgreSQL server is required for a full zero-to-current execution test; Docker
is not introduced by this repository. The generated diff must show
`genetia_app` schema-qualified objects and no `public` application objects.
